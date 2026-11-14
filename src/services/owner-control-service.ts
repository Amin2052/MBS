/**
 * Mooral Business Suite
 * Owner Control Center — Renderer Service
 *
 * Same pure-wrapper pattern as auth-service.ts / license-service.ts:
 * no logic here, only calls through the contextBridge API.
 */

export async function getSecurityPolicy(): Promise<SecurityPolicy> {

  return window.mooral.securityPolicy.get();

}

export async function setSecurityPolicy(policy: SecurityPolicy): Promise<{ success: boolean }> {

  return window.mooral.securityPolicy.set(policy);

}

export async function exportBusinessData(): Promise<{ success: boolean; filePath?: string; cancelled?: boolean; error?: string }> {

  return window.mooral.dataTransfer.export();

}

export async function importBusinessData(): Promise<ImportSummary & { cancelled?: boolean }> {

  return window.mooral.dataTransfer.import();

}

export async function resetErp(): Promise<ResetResult> {

  return window.mooral.erpControl.reset();

}

export async function factoryReset(): Promise<ResetResult> {

  return window.mooral.erpControl.factoryReset();

}
