export function taskIDFromActionPath(pathname: string, action: string): string | undefined {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length === 3 && parts[0] === "tasks" && parts[2] === action) {
    return parts[1];
  }

  return undefined;
}
