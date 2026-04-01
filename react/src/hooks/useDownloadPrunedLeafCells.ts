import { saveAs } from 'file-saver';
import { TMCHierarchyDataNode } from '../types';
import useSelectTree from './useSelectTree';

type ExportRow = {
  barcode: string;
  leaf_node_id: number;
  leaf_original_node_id: number;
};

const collectRows = (
    tree: TMCHierarchyDataNode): ExportRow[] => {
  const rows: ExportRow[] = [];

  tree.leaves().forEach(
    leaf => {
    const leafNodeId = leaf.data.prunedNodeId;
    const leafOriginalNodeId = leaf.data.originalNodeId;

    (leaf.data.items ?? []).forEach(
        item => {
            rows.push({
                barcode: item._barcode.unCell,
                leaf_node_id: leafNodeId,
                leaf_original_node_id: leafOriginalNodeId,
            });
        });
    });

  return rows;
};

const toCsv = (rows: ExportRow[]): string => {
  const header = 'barcode,leaf_node_id';
  const body = rows.map(
    r => `${r.barcode},${r.leaf_node_id}`).join('\n');
  return `${header}\n${body}\n`;
};

const useDownloadPrunedLeafCells = () => {
  const { selectTree } = useSelectTree();

  return () => {
    const selection = selectTree();

    if (
        !selection
        || selection.empty()
        || !selection.datum()
    ) {
      return;
    }

    const tree = selection.datum() as TMCHierarchyDataNode;
    const rows = collectRows(tree);

    saveAs(
      `data:text/csv,${encodeURIComponent(toCsv(rows))}`,
      'pruned-leaf-cells.csv'
    );
  };
};

export default useDownloadPrunedLeafCells;