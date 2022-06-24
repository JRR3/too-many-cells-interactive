import { useEffect, useState } from 'react';
import { bindActionCreators, compose } from 'redux';
import { HierarchyNode } from 'd3-hierarchy';
import { extent, max, median, min, range, sum, ticks } from 'd3-array';
import { AttributeMap, TMCNode } from '../types';
import {
    Distributions,
    selectActivePruneStep,
    selectPruneHistory,
    updateDistributions as _updateDistributions,
} from '../redux/pruneSlice';
import {
    selectWidth,
    TreeMetaData,
    updateTreeMetadata as _updateTreeMetadata,
} from '../redux/displayConfigSlice';
import {
    clearFeatureMaps as _clearFeatureMaps,
    FeatureDistribution,
    selectFeatureSlice,
    updateFeatureDistributions as _updateFeatureDistributions,
} from '../redux/featureSlice';
import {
    selectScales,
    updateColorScaleThresholds as _updateColorScaleThresholds,
} from '../redux/displayConfigSlice';
import {
    calculateTreeLayout,
    getEntries,
    getMAD,
    pruneStepIsEmpty,
    pruneTreeByMinDistance,
    pruneTreeByMinDistanceSearch,
    pruneTreeByMinValue,
    rerunPrunes,
} from '../util';
import useAppSelector from './useAppSelector';
import useAppDispatch from './useAppDispatch';

const usePrunedTree = (tree: HierarchyNode<TMCNode>) => {
    const [baseTree, setBaseTree] = useState(tree);
    const [visibleNodes, setVisibleNodes] = useState(tree);

    /* action creators */

    const {
        clearFeatureMaps,
        updateColorScaleThresholds,
        updateFeatureDistributions,
        updateDistributions,
        updateTreeMetadata,
    } = bindActionCreators(
        {
            clearFeatureMaps: _clearFeatureMaps,
            updateColorScaleThresholds: _updateColorScaleThresholds,
            updateDistributions: _updateDistributions,
            updateFeatureDistributions: _updateFeatureDistributions,
            updateTreeMetadata: _updateTreeMetadata,
        },
        useAppDispatch()
    );

    /* recalc layout if base changes (i.e., if nodes are re-annotated) */
    useEffect(() => {
        recalculateLayout();
    }, [baseTree]);

    const {
        colorScale: { featureThresholds },
    } = useAppSelector(selectScales);

    const { activeFeatures, featureMaps } = useAppSelector(selectFeatureSlice);

    const { step, index: activePruneIndex } = useAppSelector(
        selectActivePruneStep
    );
    const { clickPruneHistory } = step;

    const pruneHistory = useAppSelector(selectPruneHistory);

    const width = useAppSelector(selectWidth);

    /* FEATURE ANNOTATION EFFECTS: */

    useEffect(() => {
        if (Object.values(featureMaps).length) {
            //first annotate cells with new feature counts
            const treeWithCells = addFeaturesToCells(
                baseTree.copy(),
                featureMaps
            );

            const thresholds = {} as Record<string, number>;

            // then calculate new scale thresholds, which will cause next hook to fire, which will
            // calculate node-level counts based on these new thresholds

            Object.keys(featureMaps).forEach(k => {
                const range = treeWithCells
                    .leaves()
                    .flatMap(l =>
                        (l.data.items || []).map(
                            item => item._barcode._featureCounts![k] || 0
                        )
                    );

                const med = median(range.filter(Boolean))!;
                thresholds[k] = med;
            });

            updateColorScaleThresholds(thresholds);
            setBaseTree(tree);
            clearFeatureMaps();
        }
    }, [featureMaps]);

    /* when thresholds change or a new feature is added, we need to re-annotate nodes */
    useEffect(() => {
        if (activeFeatures.length || Object.keys(featureThresholds).length) {
            const annotatedTree = updatefeatureHiLos(
                tree.copy(),
                featureThresholds,
                activeFeatures
            );

            if (activeFeatures.length === 1) {
                updateFeatureCounts(annotatedTree, activeFeatures[0]);
            }

            updateFeatureDistributions(
                getFeatureDistributions(annotatedTree, activeFeatures)
            );

            setBaseTree(annotatedTree);
        }
    }, [activeFeatures, featureThresholds]);

    /* PRUNING EFFECTS */
    useEffect(() => {
        if (pruneStepIsEmpty(step)) {
            // if this is a new prune or a full revert, i.e., if step is empty recalculate base ditributions from visibleNodes
            // if it is a full revert, we'll recalc layout too (if not, then it's just meta that needs updating, the tree is the same)
            // todo: this should include feature distributions as well
            compose(
                updateDistributions,
                buildPruneMetadata
            )(activePruneIndex === 0 ? tree.copy() : visibleNodes);

            if (activePruneIndex === 0) {
                setVisibleNodes(calculateTreeLayout(tree.copy(), width));
            }
        }
    }, [step]);

    /* for now, when a prune runs, we rerun all prunes -- if performance suffers we can optimize */
    useEffect(() => {
        if (!pruneStepIsEmpty(step)) {
            recalculateLayout();
        }
    }, [clickPruneHistory, activePruneIndex]);

    /* update base tree meta on all prunes */
    useEffect(() => {
        updateTreeMetadata(buildTreeMetadata(visibleNodes));
    }, [visibleNodes]);

    const recalculateLayout = () => {
        const prunedNodes = rerunPrunes(
            activePruneIndex,
            pruneHistory,
            tree.copy()
        );
        setVisibleNodes(calculateTreeLayout(prunedNodes, width));
    };

    return visibleNodes;
};

export default usePrunedTree;

const addFeaturesToCells = (
    tree: HierarchyNode<TMCNode>,
    featureMaps: Record<string, Record<string, number>>
) => {
    getEntries(featureMaps).map(([feature, featureMap]) => {
        const range: number[] = [];

        tree.leaves().forEach(n => {
            if (n.data.items) {
                n.data.items = n.data.items.map(cell => {
                    //add the new feature to cell-level raw feature counts
                    const fcounts = cell._barcode._featureCounts || {};
                    fcounts[feature] = featureMap[cell._barcode.unCell] || 0;
                    cell._barcode._featureCounts = fcounts;
                    range.push(fcounts[feature] as number);
                    return cell;
                });
            }
        });
    });

    return tree;
};

const buildPruneMetadata = (nodes: HierarchyNode<TMCNode>): Distributions => ({
    depthGroups: getDepthGroups(nodes),
    distance: {
        mad: getMAD(
            nodes
                .descendants()
                .map(v => v.data.distance!)
                .filter(Boolean)
        )!,
        madGroups: getDistanceMadGroups(
            nodes,
            getMaxCutoffDistance(nodes),
            pruneTreeByMinDistance
        ),
        median: median(
            nodes
                .descendants()
                .map(v => v.data.distance!)
                .filter(Boolean)
        )!,
        plainGroups: getDistanceGroups(
            nodes,
            getMaxCutoffDistance(nodes),
            pruneTreeByMinDistance
        ),
    },
    distanceSearch: {
        mad: getMAD(
            nodes
                .descendants()
                .map(v => v.data.distance!)
                .filter(Boolean)
        )!,
        madGroups: getDistanceMadGroups(
            nodes,
            getMaxCutoffDistance(nodes),
            pruneTreeByMinDistanceSearch
        ),
        median: median(
            nodes
                .descendants()
                .map(v => v.data.distance!)
                .filter(Boolean)
        )!,
        plainGroups: getDistanceGroups(
            nodes,
            getMaxCutoffDistanceSearch(nodes),
            pruneTreeByMinDistanceSearch
        ),
    },
    size: {
        mad: getMAD(nodes.descendants().map(v => v.value!))!,
        madGroups: getSizeMadGroups(nodes),
        median: median(nodes.descendants().map(v => v.value!))!,
        plainGroups: getSizeGroups(nodes),
    },
});

const buildTreeMetadata = (nodes: HierarchyNode<TMCNode>): TreeMetaData => ({
    leafCount: nodes.leaves().length,
    maxDistance: max(nodes.descendants().map(n => n.data.distance!)) || 0,
    minDistance: min(nodes.descendants().map(n => n.data.distance!)) || 0,
    minValue: min(nodes.descendants().map(n => n.value!)) || 0,
    maxValue: max(nodes.descendants().map(n => n.value!)) || 0,
    nodeCount: nodes.descendants().length,
});

/**
 * @returns object keyed by integer `n` whose value is count of nodes with `depth` <= n
 */
const getDepthGroups = (tree: HierarchyNode<TMCNode>) => {
    const maxSize = max(tree.descendants().map(n => n.depth))!;

    return range(0, maxSize + 1)
        .reverse()
        .reduce<Record<number, number>>(
            (acc, curr) => ({
                ...acc,
                [curr]: tree.descendants().filter(d => d.depth <= curr).length,
            }),
            {}
        );
};

/**
 * @returns object keyed by integer `n` whose value is count of nodes with `value` <= n in tree
 */
const getDistanceGroups = (
    tree: HierarchyNode<TMCNode>,
    cutoffDistance: number,
    pruneFn: (
        tree: HierarchyNode<TMCNode>,
        size: number
    ) => HierarchyNode<TMCNode>,
    binCount = 50
) => {
    const bounds = ticks(0, cutoffDistance, binCount);

    return bounds.reduce<Record<number, number>>(
        (acc, curr) => ({
            ...acc,
            [curr]: pruneFn(tree, curr).descendants().length,
        }),
        {}
    );
};

/**
 * @returns object keyed by integer `n` whose value is count of nodes with `distance` >= median + (n * MAD) in tree
 */
const getDistanceMadGroups = (
    tree: HierarchyNode<TMCNode>,
    cutoffDistance: number,
    pruneFn: (
        tree: HierarchyNode<TMCNode>,
        size: number
    ) => HierarchyNode<TMCNode>
) => {
    const values = tree
        .descendants()
        .map(d => d.data.distance!)
        .sort((a, b) => (a < b ? -1 : 1));

    const mad = getMAD(values)!;
    const med = median(values)!;

    const maxMads = Math.ceil((cutoffDistance - med) / mad);

    const bounds = range(0, maxMads).map(m => ({
        size: med + m * mad,
        mads: m,
    }));

    return bounds.reduce<Record<number, number>>(
        (acc, curr) => ({
            ...acc,
            [curr.mads]: pruneFn(tree, curr.size).descendants().length,
        }),
        {}
    );
};

/**
 * Find the minimum size-cutoff value needed to display at least one generation of the tree
 * This ends up being the smallest grandchild of the root
 */
const getMaxCutoffDistance = (tree: HierarchyNode<TMCNode>) => {
    if (tree.children) {
        return min(
            tree.children.flatMap(d =>
                d.children ? d.children.map(d => d.data.distance || 0) : 0
            )
        )!;
    } else return 0;
};

/**
 * Find the minimum size-cutoff value needed to display at least one generation of the tree
 * This ends up being the smallest child of the root
 */
const getMaxCutoffDistanceSearch = (tree: HierarchyNode<TMCNode>) => {
    if (tree.children) {
        return min(tree.children.map(d => d.data.distance || 0))!;
    } else return 0;
};

/**
 * Find the minimum size-cutoff value needed to display at least one generation of the tree
 * This ends up being the smallest child of the root
 */
const getMaxCutoffNodeSize = (tree: HierarchyNode<TMCNode>) => {
    if (tree.children) {
        return min(tree.children.map(d => d.value || 0));
    } else return 0;
};

/**
 * @returns object keyed by integer `n` whose value is count of nodes with `value` <= n in tree
 */
const getSizeGroups = (tree: HierarchyNode<TMCNode>, binCount = 50) => {
    const maxSize = getMaxCutoffNodeSize(tree)!;

    const bounds = ticks(0, maxSize, binCount);

    return bounds.reduce<Record<number, number>>(
        (acc, curr) => ({
            ...acc,
            [curr]: pruneTreeByMinValue(tree, curr).descendants().length,
        }),
        {}
    );
};

/**
 * @returns object keyed by integer `n` whose value is count of nodes with `value` >= median + (n * MAD) in tree
 */
const getSizeMadGroups = (tree: HierarchyNode<TMCNode>) => {
    const maxSize = getMaxCutoffNodeSize(tree)!;

    const values = tree
        .descendants()
        .map(d => d.value!)
        .sort((a, b) => (a < b ? -1 : 1));

    const mad = getMAD(values)!;
    const med = median(values)!;

    const maxMads = Math.ceil((maxSize - med) / mad);

    const bounds = range(0, maxMads).map(m => ({
        size: med + m * mad,
        mads: m,
    }));

    return bounds.reduce<Record<number, number>>(
        (acc, curr) => ({
            ...acc,
            [curr.mads]: pruneTreeByMinValue(tree, curr.size).descendants()
                .length,
        }),
        {}
    );
};

const getFeatureDistributions = (
    nodes: HierarchyNode<TMCNode>,
    activeFeatures: string[]
) => {
    const distributions = {} as Record<string, FeatureDistribution>;

    activeFeatures.forEach(f => {
        const range = nodes
            .leaves()
            .flatMap(l =>
                (l.data.items || []).map(
                    item => item._barcode._featureCounts![f] || 0
                )
            );

        const maxProportion =
            max(
                nodes
                    .descendants()
                    .map(d => d.data.featureCount[f]?.quantity || 0)
            ) || 0;

        const med = median(range.filter(Boolean))!;

        const medianWithZeroes = median(range)!;

        const mad = getMAD(range.filter(Boolean)) || 0;

        distributions[f] = {
            mad,
            madGroups: getMadFeatureGroups(range.filter(Boolean), mad, med),
            madWithZeroes: getMAD(range) || 0, //remove 0s
            max: max(range) || 0,
            maxProportion,
            min: min(range) || 0,
            median: med || 0,
            medianWithZeroes: medianWithZeroes || 0,
            plainGroups: getPlainFeatureGroups(range.filter(Boolean)),
            total: sum(range) || 0,
        };
    });

    return distributions;
};

const getPlainFeatureGroups = (range: number[]) => {
    const [min, max] = extent(range) as [number, number];
    const thresholds = ticks(min, max, Math.min(max, 25));

    return thresholds.reduce<Record<number, number>>(
        (acc, curr) => ({
            ...acc,
            [curr]: range.filter(n => n > curr).length,
        }),
        {}
    );
};

const getMadFeatureGroups = (range: number[], mad: number, median: number) => {
    const maxVal = max(range) || 0;

    const maxMads = Math.ceil((maxVal - median) / mad);

    const thresholds = ticks(0, maxMads, Math.min(maxMads, 25));

    return thresholds.reduce<Record<number, number>>(
        (acc, curr) => ({
            ...acc,
            [curr]: range.filter(n => n > median + mad * curr).length,
        }),
        {}
    );
};

/**
 *
 * @param nodes the base tree (not a pruned tree)
 * @param feature the (single) active feature
 * @returns HierarchyNode<TMCNode> (mutated argument)
 */
const updateFeatureCounts = (nodes: HierarchyNode<TMCNode>, feature: string) =>
    nodes.eachAfter(n => {
        if (n.data.items) {
            n.data.featureCount = {
                [feature]: {
                    quantity:
                        n.data.items.reduce(
                            (acc, curr) =>
                                (acc +=
                                    curr._barcode._featureCounts[feature] || 0),
                            0
                        ) / n.value!,
                    scaleKey: feature,
                },
            };
        } else {
            n.data.featureCount = {
                [feature]: {
                    quantity:
                        (n.children![0].data.featureCount[feature].quantity +
                            n.children![1].data.featureCount[feature]
                                .quantity) /
                        (n.descendants().length - 1),
                    scaleKey: feature,
                },
            };
        }
    });

/**
 *
 * @param nodes the base tree (not a pruned tree)
 * @param thresholds the cutoff for hi/lo for each feature
 * @param activeFeatures the features currently visible
 * @returns HierarchyNode<TMCNode> (mutated argument)
 */
const updatefeatureHiLos = (
    nodes: HierarchyNode<TMCNode>,
    thresholds: Record<string, number>,
    activeFeatures: string[]
) =>
    nodes.eachAfter(n => {
        // for the scale to read
        const hilo = {} as AttributeMap;
        //if these are leaves, store and calculate base values
        if (n.data.items) {
            n.data.items.forEach(cell => {
                //reduce cells for each node to hi/lows
                const key = getEntries(cell._barcode._featureCounts)
                    .filter(([k, _]) => activeFeatures.includes(k))
                    //alphabetize keys for standardization
                    .sort(([k1], [k2]) => (k1 < k2 ? -1 : 1))
                    .reduce(
                        (acc, [k, v]) =>
                            `${acc ? acc + '-' : ''}${
                                v && v >= thresholds[k] ? 'high' : 'low'
                            }-${k}`,
                        ''
                    );
                //add to node's running total of hilos
                if (key) {
                    hilo[key] = hilo[key]
                        ? { ...hilo[key], quantity: hilo[key].quantity + 1 }
                        : { scaleKey: key, quantity: 1 };
                }
            });
        } else {
            //if node is not a leaf, just add both children
            n.children!.map(node => node.data.featureHiLos).forEach(count => {
                for (const featurekey in count) {
                    if (!hilo[featurekey]) {
                        hilo[featurekey] = count[featurekey];
                    } else {
                        hilo[featurekey].quantity += count[featurekey].quantity;
                    }
                }
            });
        }
        n.data.featureHiLos = hilo;
    });
