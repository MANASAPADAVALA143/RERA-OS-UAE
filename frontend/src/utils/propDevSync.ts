export const PROPDEV_COMPANIES_REFRESH = 'estatecfo:propdev-companies-refresh';

export function notifyPropDevCompaniesRefresh() {
  window.dispatchEvent(new Event(PROPDEV_COMPANIES_REFRESH));
}
