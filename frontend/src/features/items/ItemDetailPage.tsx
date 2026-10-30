import { useParams } from 'react-router-dom';
import { ItemsListPage } from './ItemsListPage';

/** /items/:id and /items/new open the item in a drawer over the catalogue list. */
export function ItemDetailPage() {
  const { id } = useParams<{ id: string }>();
  return <ItemsListPage routeId={id ?? 'new'} />;
}
