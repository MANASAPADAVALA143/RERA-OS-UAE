/** Browser print → PDF for the active Rentals section (current page content). */
export function printRentalSection(sectionLabel: string): void {
  const prev = document.title;
  document.title = `EstateCFO Rentals — ${sectionLabel}`;
  window.print();
  window.setTimeout(() => {
    document.title = prev;
  }, 500);
}
