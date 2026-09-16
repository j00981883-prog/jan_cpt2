import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type CsvRow = Record<string, string>;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json; charset=utf-8" },
});

function parseCsv(text: string): CsvRow[] {
  const table: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  const pushField = () => { row.push(field); field = ""; };
  const pushRow = () => {
    if (row.some((value) => value.trim() !== "")) table.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") pushField();
    else if (ch === "\n") { pushField(); pushRow(); }
    else if (ch !== "\r") field += ch;
  }
  pushField(); pushRow();
  if (quoted) throw new Error("The CSV has an unfinished quoted value.");
  if (table.length < 2) throw new Error("A header and at least one data row are required.");
  const clean = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  const headers = table[0].map(clean);
  return table.slice(1).map((columns) => Object.fromEntries(
    headers.map((header, index) => [header, (columns[index] || "").trim()]).filter(([header]) => header),
  ));
}

function value(row: CsvRow, aliases: string[]): string {
  for (const alias of aliases) {
    const key = alias.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (row[key]) return row[key];
  }
  return "";
}

function money(raw: string): number | null {
  if (!raw) return null;
  const negative = /^\(.*\)$/.test(raw.trim());
  const parsed = Number(raw.replace(/[$,()\s]/g, ""));
  if (!Number.isFinite(parsed)) return null;
  return negative ? -parsed : parsed;
}

const key = (input: unknown) => String(input || "").trim().toUpperCase().replace(/\s+/g, "");

function dateOnly(raw: string): string | null {
  const input = raw.trim();
  if (!input) return null;
  const us = input.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const iso = us
    ? `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`
    : input.match(/^\d{4}-\d{2}-\d{2}$/) ? input : "";
  if (!iso || Number.isNaN(Date.parse(`${iso}T00:00:00Z`))) return null;
  return iso;
}

async function sha256(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "POST required" }, 405);
  const expectedSecret = Deno.env.get("MUNIS_SYNC_SECRET") || "";
  if (!expectedSecret || request.headers.get("x-jan-cpt-sync-secret") !== expectedSecret) {
    return json({ error: "Unauthorized" }, 401);
  }

  try {
    const body = await request.json();
    const fileName = String(body.fileName || "MUNIS report.csv").slice(0, 240);
    const source = String(body.source || "SharePoint / OneDrive").slice(0, 120);
    const csvText = String(body.csvText || "");
    if (!csvText || csvText.length > 2 * 1024 * 1024) return json({ error: "CSV must be between 1 byte and 2 MB." }, 400);

    const reportHash = await sha256(csvText);
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );
    const { data: duplicate } = await supabase.from("munis_sync_runs")
      .select("id,created_at,row_count,matched_count,change_count")
      .eq("report_hash", reportHash).maybeSingle();
    if (duplicate) return json({ ok: true, duplicate: true, previewOnly: true, run: duplicate });

    const rows = parseCsv(csvText).map((row) => ({
      projectNo: value(row, ["munis_project_number", "munis project number", "project_number", "project no", "project id"]),
      title: value(row, ["project_title", "project name", "description"]),
      budget: money(value(row, ["revised_budget", "revised budget", "project budget", "budget"])),
      actual: money(value(row, ["actual_spend", "actual expenditures", "expenditures", "spent", "ytd actual"])),
      encumbrances: money(value(row, ["encumbrances", "encumbered", "open commitments"])),
      available: money(value(row, ["available_balance", "available budget", "remaining balance"])),
      reportDate: value(row, ["report_date", "as of date", "report date"]),
    }));
    if (!rows.some((row) => row.projectNo)) return json({ error: "No project-number column was found." }, 400);

    const { data: projects, error: projectError } = await supabase.from("projects").select("id,title,meta");
    if (projectError) throw projectError;
    const projectMap = new Map((projects || []).map((project) => [
      key(project.meta?.munisProjectNo || project.meta?.projectNo), project,
    ]).filter(([projectKey]) => projectKey));

    const preview = rows.map((row) => {
      const project = projectMap.get(key(row.projectNo));
      const currentBudget = project ? Number(project.meta?.primeBudget) || 0 : null;
      const budgetChanged = !!project && row.budget !== null && Math.abs(row.budget - currentBudget) >= 0.01;
      return {
        ...row,
        matched: !!project,
        projectId: project?.id || null,
        dashboardTitle: project?.title || null,
        currentBudget,
        budgetChanged,
      };
    });
    const reportDate = dateOnly(rows.map((row) => row.reportDate).find(Boolean) || "");
    const run = {
      report_name: fileName,
      report_hash: reportHash,
      source,
      status: "preview",
      report_date: reportDate,
      row_count: preview.length,
      matched_count: preview.filter((row) => row.matched).length,
      change_count: preview.filter((row) => row.budgetChanged).length,
      preview,
    };
    const { data: saved, error: saveError } = await supabase.from("munis_sync_runs").insert(run).select("id,created_at").single();
    if (saveError) throw saveError;
    return json({
      ok: true,
      previewOnly: true,
      message: "Preview staged. No JAN CPT financial records were changed.",
      run: { ...saved, rowCount: run.row_count, matchedCount: run.matched_count, changeCount: run.change_count },
      preview,
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
});
