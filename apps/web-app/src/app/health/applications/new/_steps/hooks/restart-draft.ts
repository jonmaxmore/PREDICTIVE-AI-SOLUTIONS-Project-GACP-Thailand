/**
 * The only way to change a wrong holder (spec 2026-09-30-remove-workspace-mode §3.2):
 * delete the draft, clear the wizard, start again from step 1 with no holder chosen.
 * If the delete fails nothing else happens, so the draft and its holder stay as they were.
 */
export interface RestartDeps {
    applicationId: string | null;
    deleteDraft: (url: string) => Promise<{ success: boolean }>;
    resetWizard: () => void;
    navigate: (url: string) => void;
}

export const STEP_ONE_URL = '/health/applications/new/step/1';

export async function restartFromStep1(deps: RestartDeps): Promise<'RESTARTED' | 'FAILED'> {
    if (deps.applicationId) {
        const res = await deps.deleteDraft(`/applications/draft/${deps.applicationId}`);
        if (!res.success) { return 'FAILED'; }
    }
    deps.resetWizard();
    deps.navigate(STEP_ONE_URL);
    return 'RESTARTED';
}
