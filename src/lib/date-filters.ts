export function todayInputValue(date = new Date()) {
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return offsetDate.toISOString().slice(0, 10);
}

function addDays(input: string, days: number) {
  const date = new Date(`${input}T00:00:00`);
  date.setDate(date.getDate() + days);
  return todayInputValue(date);
}

export function formatFilterDate(input: string, today = todayInputValue()) {
  if (!input) return "All dates";
  if (input === today) return "Today";
  if (input === addDays(today, -1)) return "Yesterday";
  if (input === addDays(today, 1)) return "Tomorrow";
  const [year, month, day] = input.split("-");
  return day && month && year ? `${day}/${month}/${year}` : input;
}
