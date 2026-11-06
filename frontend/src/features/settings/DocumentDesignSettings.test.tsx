import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DocumentDesignSettings } from './DocumentDesignSettings';

const apiPut = vi.fn((_p: string, body: unknown) => Promise.resolve(body));
const fetchWithAuth = vi.fn(() => Promise.resolve(new Response(new Blob(['%PDF']), { status: 200 })));
vi.mock('@/shared/lib/api', () => ({
  apiGet: () => Promise.resolve({ template: 'classic', accent_color: '#1f3a5f', footer_blocks: ['bank'] }),
  apiPut: (p: string, b: unknown) => apiPut(p, b),
  fetchWithAuth: (...a: unknown[]) => fetchWithAuth(...(a as [])),
  getErrorMessage: (e: unknown) => String(e),
}));

describe('DocumentDesignSettings', () => {
  it('previews the unsaved design and saves it', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:preview');
    URL.revokeObjectURL = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <DocumentDesignSettings canEdit />
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole('radio', { name: 'Modern' }));
    await waitFor(() => expect(screen.getByTestId('document-design-preview')).toBeTruthy(), { timeout: 3000 });
    const calls = fetchWithAuth.mock.calls as unknown as [string, RequestInit][];
    expect(JSON.parse(String(calls.at(-1)![1].body)).design.template).toBe('modern');
    fireEvent.click(screen.getByRole('button', { name: /save design/i }));
    await waitFor(() => expect(apiPut).toHaveBeenCalled());
    expect((apiPut.mock.calls[0]![1] as { template: string }).template).toBe('modern');
  });
});
