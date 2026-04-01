import { saveAs } from 'file-saver';
import { TMCHierarchyDataNode } from '../types';
import useSelectTree from './useSelectTree';

type ExportRow = {
  barcode: string;
  leaf_node_id: number;           // current pruned visible node id
  leaf_original_node_id: number;  // original node id of visible terminal node
};

const collectItemsFromSubtree = (
    node: TMCHierarchyDataNode): any[] => {
  const ownItems = node.data.items ?? [];

  if (!node.children || node.children.length === 0) {
    return ownItems;
  }

  return node.children.flatMap(
    child => collectItemsFromSubtree(child));
};

const collectRowsFromVisibleAndOriginal = (
  visibleTree: TMCHierarchyDataNode,
  originalTree: TMCHierarchyDataNode
): ExportRow[] => {
  const rows: ExportRow[] = [];

  visibleTree.leaves().forEach(visibleLeaf => {
    const prunedNodeId = visibleLeaf.data.prunedNodeId;
    const originalNodeId = visibleLeaf.data.originalNodeId;

    const sourceNode = originalTree.find(
      n => n.data.originalNodeId === originalNodeId
    );

    if (!sourceNode) {
      console.warn(
        `No matching original node found for originalNodeId=${originalNodeId}`
      );
      return;
    }

    const items = collectItemsFromSubtree(sourceNode);

    items.forEach(item => {
      rows.push({
        barcode: item._barcode.unCell,
        leaf_node_id: prunedNodeId,
        leaf_original_node_id: originalNodeId,
      });
    });
  });

  return rows;
};



const toCsv = (rows: ExportRow[]): string => {
  const header = 'barcode,leaf_node_id,leaf_original_node_id';
  const body = rows.map(
    r => `${r.barcode},${r.leaf_node_id},${r.leaf_original_node_id}`
    ).join('\n');
  return `${header}\n${body}\n`;
};

const useDownloadPrunedLeafCells = (
    originalTree: TMCHierarchyDataNode) => {
  const { selectTree } = useSelectTree();

  return () => {
    const selection = selectTree();

    if (
        !selection
        || selection.empty()
        || !selection.datum()
    ) {
      console.error(
        "Export failed: Tree selection is empty or missing."
        )
      return;
    }

    const visibleTree = selection.datum() as TMCHierarchyDataNode;

    console.log(
        'Visible terminal nodes:',
        visibleTree.leaves().map(
            n => (
                {
                    prunedNodeId: n.data.prunedNodeId,
                    originalNodeId: n.data.originalNodeId,
                })
        )
    );
    //How to call the function?
    const rows = collectRowsFromVisibleAndOriginal(
        visibleTree,
        originalTree,
    );

    console.log('Export row count:', rows.length);

    if (!rows.length){
        console.warn("Export produced 0 rows!")
    }
    const blob = new Blob(
        [toCsv(rows)], {
            type: 'text/csv;charset=utf-8',
        }
    );

    saveAs(blob, 'cell2prunedClusters.csv');
  };
};

export default useDownloadPrunedLeafCells;