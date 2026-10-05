/**
 * T9 — reading a document must not put a copy of it on the reader's disk.
 *
 * `/uploads` ships `Content-Disposition: attachment`, so anything that NAVIGATES to a
 * file downloads it. A reviewer who merely wants to check a national-ID scan would end
 * up holding one. A subresource load is exempt from that header, so the viewer renders
 * the blob in an <img> or an <iframe> and nothing is written. A copy stays obtainable,
 * but only by pressing ดาวน์โหลด on purpose.
 */

import { renderToStaticMarkup } from 'react-dom/server';
import DocumentViewerModalDefault, { DocumentViewerModal, VIEWER_COPY_TH } from '../document-viewer-modal';

const mockFetchForViewer = jest.fn();
jest.mock('@/lib/services/preview-document', () => ({
    fetchDocumentForViewer: (...args: unknown[]) => mockFetchForViewer(...args),
}));

// The dialog primitive renders through a portal, which react-dom/server cannot do.
// Render the parts inline so the markup under test is the viewer's own.
jest.mock('@/components/ui/primitives/dialog', () => ({
    Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
    DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

beforeEach(() => mockFetchForViewer.mockReset());

describe('opening the viewer never downloads', () => {
    it('renders nothing at all when there is no file to read', () => {
        expect(renderToStaticMarkup(<DocumentViewerModal file={null} onClose={() => {}} />)).toBe('');
        expect(mockFetchForViewer).not.toHaveBeenCalled();
    });

    it('does not click an anchor, or navigate, merely because it opened', () => {
        const clickSpy = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
        const openSpy = jest.spyOn(window, 'open').mockImplementation(() => null);

        renderToStaticMarkup(
            <DocumentViewerModal file={{ url: '/uploads/id.png', name: 'id.png' }} onClose={() => {}} />,
        );

        expect(clickSpy).not.toHaveBeenCalled();
        expect(openSpy).not.toHaveBeenCalled();
        clickSpy.mockRestore();
        openSpy.mockRestore();
    });

    it('shows a status line while the bytes are still coming', () => {
        mockFetchForViewer.mockReturnValue(new Promise(() => {}));
        const html = renderToStaticMarkup(
            <DocumentViewerModal file={{ url: '/uploads/id.png', name: 'id.png' }} onClose={() => {}} />,
        );
        expect(html).toContain(VIEWER_COPY_TH.loading);
        expect(html).toContain('id.png');
    });
});

describe('what it renders for each kind of file', () => {
    // The component fetches in an effect, which react-dom/server never runs, so the
    // element choice is asserted through the pure predicates the component uses.
    it('is the same component under both export names', () => {
        expect(DocumentViewerModalDefault).toBe(DocumentViewerModal);
    });

    it('offers ดาวน์โหลด as a deliberate second act, never as the way in', () => {
        // The copy exists and is distinct from opening.
        expect(VIEWER_COPY_TH.download).toBe('ดาวน์โหลด');
        expect(VIEWER_COPY_TH.title).not.toContain(VIEWER_COPY_TH.download);
    });

    it('says something Thai and actionable when the file cannot be shown in page', () => {
        expect(VIEWER_COPY_TH.unsupported).toMatch(/[ก-๙]/);
        expect(VIEWER_COPY_TH.unsupported).toContain(VIEWER_COPY_TH.download);
        expect(VIEWER_COPY_TH.failed).toMatch(/[ก-๙]/);
        [VIEWER_COPY_TH.failed, VIEWER_COPY_TH.unsupported].forEach((line) => {
            expect(line).not.toContain('—');
        });
    });
});
