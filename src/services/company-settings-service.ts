/**
 * Mooral Business Suite
 * Company Settings Foundation
 *
 * This is a pure renderer-side service. It holds NO filesystem, Node, or
 * Electron main-process logic. All persistence happens in the Electron
 * main process; this service only talks to it through the contextBridge
 * API exposed on `window.mooral.settings` (get/save), following the same
 * pattern as the other renderer services (products, customers, orders,
 * invoices, accounting, etc.).
 *
 * Other modules can safely read defaults (e.g. default currency, default
 * language, default invoice prefix) through this service by awaiting
 * getCompanySettings().
 */

import { DEFAULT_COMPANY_SETTINGS } from "@/constants/company-settings";

import type { CompanySettings } from "@/types/company-settings";


export async function getCompanySettings(): Promise<CompanySettings> {

  try {

    const stored = await window.mooral.settings.get();

    return {
      ...DEFAULT_COMPANY_SETTINGS,
      ...stored
    };

  }
  catch {

    return { ...DEFAULT_COMPANY_SETTINGS };

  }

}


export async function updateCompanySettings(
  patch: Partial<CompanySettings>
): Promise<CompanySettings> {

  const next = {
    ...(await getCompanySettings()),
    ...patch
  };

  await window.mooral.settings.save(next);

  return next;

}


export async function resetCompanySettings(): Promise<CompanySettings> {

  const defaults = { ...DEFAULT_COMPANY_SETTINGS };

  await window.mooral.settings.save(defaults);

  return defaults;

}
