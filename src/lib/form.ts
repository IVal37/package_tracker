/** A form field as text; empty when it is missing. */
export function formText(formData: FormData, field: string): string {
  return String(formData.get(field) ?? "");
}
