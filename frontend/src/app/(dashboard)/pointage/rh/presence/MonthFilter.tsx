"use client";

export function MonthFilter({
  dateParam,
  defaultValue,
}: {
  dateParam?: string;
  defaultValue: string;
}) {
  return (
    <form method="GET" action="/pointage/rh/presence" className="flex items-center gap-2">
      {dateParam && <input type="hidden" name="date" value={dateParam} />}
      <input
        type="month"
        name="mois"
        defaultValue={defaultValue}
        onChange={(e) => e.target.form?.submit()}
        className="text-xs rounded-md border border-border px-2 py-1 bg-surface text-foreground"
      />
    </form>
  );
}
