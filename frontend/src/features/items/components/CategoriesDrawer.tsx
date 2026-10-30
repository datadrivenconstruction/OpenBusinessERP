import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { CornerDownRight, FolderTree, Plus, Trash2 } from 'lucide-react';
import { Button, ConfirmDialog, SideDrawer } from '@/shared/ui';
import { getErrorMessage } from '@/shared/lib/api';
import { itemsApi } from '../api';
import { buildCategoryTree, type CategoryNode } from '../itemsLogic';
import { control } from './ItemBits';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Filter the list by a category. */
  onPick: (categoryId: string) => void;
}

export function CategoriesDrawer({ open, onClose, onPick }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const cats = useQuery({ queryKey: ['items', 'categories'], queryFn: itemsApi.categories, enabled: open, retry: false });
  const counts = useQuery({ queryKey: ['items', 'category-counts'], queryFn: itemsApi.categoryCounts, enabled: open, retry: false });
  const tree = useMemo(() => buildCategoryTree(cats.data ?? [], counts.data ?? []), [cats.data, counts.data]);
  const uncategorised = counts.data?.find((r) => r.category_id === null)?.count ?? 0;

  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [newName, setNewName] = useState('');
  const [newParent, setNewParent] = useState('');
  const [toDelete, setToDelete] = useState<CategoryNode | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['items'] });
  const onError = (e: unknown) => setErr(getErrorMessage(e));

  const create = useMutation({
    mutationFn: () => itemsApi.createCategory(newName.trim(), newParent || null),
    onSuccess: () => { setNewName(''); setErr(null); refresh(); },
    onError,
  });
  const rename = useMutation({
    mutationFn: (p: { id: string; name: string }) => itemsApi.updateCategory(p.id, { name: p.name }),
    onSuccess: () => { setEditing(null); setErr(null); refresh(); },
    onError,
  });
  const remove = useMutation({
    mutationFn: (id: string) => itemsApi.removeCategory(id),
    onSuccess: () => { setToDelete(null); refresh(); },
    onError,
  });

  const commit = (node: CategoryNode) => {
    const name = draft.trim();
    if (!name || name === node.name) setEditing(null);
    else rename.mutate({ id: node.id, name });
  };

  return (
    <SideDrawer
      open={open}
      onClose={onClose}
      title={t('items.categories_title', { defaultValue: 'Categories' })}
      subtitle={t('items.categories_subtitle', { defaultValue: 'Group products and services. Double-click a name to rename it.' })}
    >
      <div className="space-y-4 p-4 sm:p-5">
        {err && <p role="alert" className="text-sm text-semantic-error">{err}</p>}
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => { e.preventDefault(); if (newName.trim()) create.mutate(); }}
        >
          <input
            className={clsx(control, 'min-w-[10rem] flex-1')}
            placeholder={t('items.new_category', { defaultValue: 'New category' })}
            aria-label={t('items.new_category', { defaultValue: 'New category' })}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <select className={clsx(control, 'w-40')} value={newParent} onChange={(e) => setNewParent(e.target.value)} aria-label={t('items.parent_category', { defaultValue: 'Parent category' })}>
            <option value="">{t('items.top_level', { defaultValue: 'Top level' })}</option>
            {tree.map((c) => <option key={c.id} value={c.id}>{'  '.repeat(c.depth)}{c.name}</option>)}
          </select>
          <Button type="submit" size="sm" variant="primary" icon={<Plus size={14} />} disabled={!newName.trim() || create.isPending}>
            {t('common.add', { defaultValue: 'Add' })}
          </Button>
        </form>

        {tree.length === 0 && !cats.isLoading ? (
          <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-content-tertiary">
            <FolderTree className="mx-auto mb-2" size={22} />
            {t('items.no_categories', { defaultValue: 'No categories yet. Add one above — for example "Materials", "Labour" or "Rentals".' })}
          </div>
        ) : (
          <ul className="divide-y divide-border-light rounded-lg border border-border-light" role="tree">
            {tree.map((c) => (
              <li key={c.id} role="treeitem" aria-level={c.depth + 1} className="group flex items-center gap-2 px-3 py-2 text-sm" style={{ paddingLeft: 12 + c.depth * 20 }}>
                {c.depth > 0 && <CornerDownRight size={13} className="text-content-tertiary" />}
                {editing === c.id ? (
                  <input
                    autoFocus
                    className={clsx(control, 'h-8 flex-1')}
                    value={draft}
                    aria-label={t('items.rename_category', { defaultValue: 'Rename category' })}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={() => commit(c)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commit(c);
                      if (e.key === 'Escape') { e.stopPropagation(); setEditing(null); }
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className="flex-1 truncate text-left text-content-primary hover:underline"
                    title={t('items.category_click_hint', { defaultValue: 'Click to show its items, double-click or F2 to rename' })}
                    onClick={() => onPick(c.id)}
                    onDoubleClick={() => { setEditing(c.id); setDraft(c.name); }}
                    onKeyDown={(e) => { if (e.key === 'F2') { setEditing(c.id); setDraft(c.name); } }}
                  >
                    {c.name}
                  </button>
                )}
                <span className="tabular-nums text-xs text-content-tertiary" title={t('items.category_count_hint', { defaultValue: 'Items here / including sub-categories' })}>
                  {c.count}{c.total !== c.count ? ` / ${c.total}` : ''}
                </span>
                <button
                  type="button"
                  className="rounded p-1 text-content-tertiary opacity-0 hover:text-semantic-error focus:opacity-100 group-hover:opacity-100"
                  aria-label={t('items.delete_category', { defaultValue: 'Delete category {{name}}', name: c.name })}
                  onClick={() => setToDelete(c)}
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
            {uncategorised > 0 && (
              <li className="flex items-center gap-2 px-3 py-2 text-sm text-content-tertiary">
                <span className="flex-1 italic">{t('items.insights.uncategorised', { defaultValue: 'Uncategorised' })}</span>
                <span className="tabular-nums text-xs">{uncategorised}</span>
              </li>
            )}
          </ul>
        )}
      </div>
      <ConfirmDialog
        open={!!toDelete}
        title={t('items.delete_category_title', { defaultValue: 'Delete this category?' })}
        message={t('items.delete_category_body', { defaultValue: 'Its {{n}} item(s) stay in the catalogue without a category.', n: toDelete?.count ?? 0 })}
        confirmLabel={t('common.delete', { defaultValue: 'Delete' })}
        loading={remove.isPending}
        onCancel={() => setToDelete(null)}
        onConfirm={() => toDelete && remove.mutate(toDelete.id)}
      />
    </SideDrawer>
  );
}
