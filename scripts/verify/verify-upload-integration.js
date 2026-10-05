const { Blob } = require('buffer');
const {
  BASE_URL,
  assert,
  authHeader,
  loginHealth,
  requestWithRetry,
} = require('../test/regression-test-helpers');

/**
 * A structurally real PDF, comfortably over the 1,835-byte floor the upload guard
 * applies (packages/validation/src/upload-rules.js MIN_DOCUMENT_BYTES).
 *
 * The old fixture here was a 70-byte 1x1 PNG posted into ภ.ท.9 — a PDF-only slot. That
 * is precisely the upload F-G4-08 was raised for, and the door this script now uses
 * refuses it on the server: wrong magic bytes AND under the floor. A regression gate
 * has to send what a farmer sends, so it sends a document.
 */
function realisticPdf() {
  const header = '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n';
  const filler = `% ${'gacp upload integration check '.repeat(80)}\n`;
  const trailer = 'trailer<</Root 1 0 R>>\n%%EOF\n';
  return Buffer.from(header + filler + trailer, 'utf8');
}

async function uploadDraftDocument(token, applicationId) {
  const form = new FormData();
  const file = new Blob([realisticPdf()], { type: 'application/pdf' });

  form.append('file', file, 'upload-integration-check.pdf');
  form.append('slotId', 'LICENCE_PT09');
  form.append('stepKey', 'step-documents');
  form.append('applicationId', applicationId);

  const response = await fetch(`${BASE_URL}/applications/draft-documents`, {
    method: 'POST',
    headers: {
      ...authHeader(token),
    },
    body: form,
  });

  const body = await response.json();
  assert(response.ok, `Upload draft document failed: ${response.status} ${JSON.stringify(body)}`);
  assert(body?.success, `Upload draft document returned success=false: ${JSON.stringify(body)}`);
  assert(body?.data?.documentId, 'Upload response missing documentId');

  return body.data;
}

// กทล.1 v2 (spec 2026-09-01 §6): /wizard/draft-documents was a second upload door into
// a second store and is gone. Everything a farmer touches — the wizard, the mobile app,
// the planting screens — posts to /applications/draft-documents, so the gate checks THAT
// door: the one whose files reach the officer and the requirement lens.
async function run() {
  console.log('[verify-upload-integration] BASE_URL =', BASE_URL);

  const token = await loginHealth();
  assert(!!token, 'Missing health token');

  const draftSave = await requestWithRetry('/applications/draft', {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify({
      plantId: 'cannabis',
      serviceType: 'new_application',
      currentStep: 3,
      formData: {
        applicantName: 'Upload Integration Check',
      },
    }),
  }, { attempts: 4, delayMs: 600 });

  assert(draftSave.response.ok, `Save draft failed: ${draftSave.response.status}`);
  assert(draftSave.body?.success, 'Save draft returned success=false');

  // The applications draft door answers with `draftId` (and `_id`), never `id`.
  const draftId = String(draftSave.body?.data?.draftId || draftSave.body?.data?._id || '').trim();
  assert(draftId, 'Save draft response missing draft id');

  const uploaded = await uploadDraftDocument(token, draftId);

  const listAfterUpload = await requestWithRetry(`/applications/draft-documents?applicationId=${encodeURIComponent(draftId)}`, {
    method: 'GET',
    headers: authHeader(token),
  }, { attempts: 4, delayMs: 600 });

  assert(listAfterUpload.response.ok, `List draft documents failed: ${listAfterUpload.response.status}`);
  assert(listAfterUpload.body?.success, 'List draft documents returned success=false');

  const docs = listAfterUpload.body?.data?.documents || [];
  const found = docs.find((doc) => String(doc.documentId) === String(uploaded.documentId));
  assert(found, `Uploaded document ${uploaded.documentId} not found in draft documents`);

  const deleteResponse = await requestWithRetry(
    `/applications/draft-documents/${encodeURIComponent(uploaded.documentId)}?applicationId=${encodeURIComponent(draftId)}`,
    {
      method: 'DELETE',
      headers: authHeader(token),
    },
    { attempts: 4, delayMs: 600 },
  );

  assert(deleteResponse.response.ok, `Delete draft document failed: ${deleteResponse.response.status}`);
  assert(deleteResponse.body?.success, 'Delete draft document returned success=false');

  const listAfterDelete = await requestWithRetry(`/applications/draft-documents?applicationId=${encodeURIComponent(draftId)}`, {
    method: 'GET',
    headers: authHeader(token),
  }, { attempts: 4, delayMs: 600 });

  assert(listAfterDelete.response.ok, `List after delete failed: ${listAfterDelete.response.status}`);
  assert(listAfterDelete.body?.success, 'List after delete returned success=false');

  const docsAfterDelete = listAfterDelete.body?.data?.documents || [];
  const stillExists = docsAfterDelete.some((doc) => String(doc.documentId) === String(uploaded.documentId));
  assert(!stillExists, `Document ${uploaded.documentId} still exists after delete`);

  console.log('[verify-upload-integration] PASS');
  console.log(JSON.stringify({
    applicationId: draftId,
    uploadedDocumentId: uploaded.documentId,
    // The applications door does not echo the slot back; it is what we posted.
    uploadedSlot: 'LICENCE_PT09',
    uploadedFileName: uploaded.fileName,
  }, null, 2));
}

run().catch((error) => {
  console.error('[verify-upload-integration] FAIL:', error.message);
  process.exit(1);
});
