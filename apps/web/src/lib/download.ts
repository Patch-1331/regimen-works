/**
 * Hands the browser a file to save. The API's routes need the Clerk token,
 * so a file the API makes is fetched like any other response and saved from
 * here, rather than linked to.
 */
export function saveJson(filename: string, data: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  // After the click has handed the file over, not before.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
