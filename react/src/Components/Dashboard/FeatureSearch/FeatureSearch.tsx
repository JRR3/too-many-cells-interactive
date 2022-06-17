import React, {
    ForwardedRef,
    forwardRef,
    InputHTMLAttributes,
    KeyboardEvent,
    MutableRefObject,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import { bindActionCreators } from 'redux';
import { range } from 'd3-array';
import styled from 'styled-components';
import { fetchFeatures, fetchFeatureNames } from '../../../../api';
import useClickAway from '../../../hooks/useClickAway';
import { getEntries, interpolateColorScale, levenshtein } from '../../../util';
import Button from '../../Button';
import { Input, NumberInput } from '../../Input';
import { Column, Row } from '../../Layout';
import Modal from '../../Modal';
import { Caption, Title } from '../../Typography';
import { CloseIcon } from '../../Icons';
import { RadioButton, RadioGroup, RadioLabel } from '../../Radio';
import Checkbox from '../../Checkbox';
import { useAppDispatch, useAppSelector } from '../../../hooks';
import {
    selectScales,
    updateColorScale as _updateColorScale,
    updateColorScaleThresholds as _updateColorScaleThresholds,
    updateColorScaleType as _updateColorScaleType,
} from '../../../redux/displayConfigSlice';
import {
    addFeature as _addFeature,
    clearActiveFeatures as _clearActiveFeatures,
    FeatureDistribution,
    removeActiveFeature as _removeActiveFeature,
    selectFeatureSlice,
} from '../../../redux/featureSlice';

const getScaleCombinations = (featureList: string[]) =>
    featureList
        .sort((a, b) => (a > b ? -1 : 1))
        .map(s => [`high-${s}`, `low-${s}`])
        .reduce((acc, curr) => {
            if (!acc.length) {
                return curr;
            } else {
                const ret = [];
                for (const item of acc) {
                    for (const inner of curr) {
                        ret.push(`${inner}-${item}`);
                    }
                }
                return ret;
            }
        }, []);

/**
 *
 * @param nodes
 * @param thresholds
 * @returns TMCNode: Note that the tree is mutated in place
 */

const FeatureSearch: React.FC = () => {
    const [loading, setLoading] = useState(false);
    const [featureList, setFeatureList] = useState<string[]>();

    const {
        colorScale: { featureThresholds },
    } = useAppSelector(selectScales);

    const { activeFeatures, featureDistributions } =
        useAppSelector(selectFeatureSlice);

    const {
        addFeature,
        clearActiveFeatures,
        removeActiveFeature,
        updateColorScale,
        updateColorScaleThresholds,
        updateColorScaleType,
    } = bindActionCreators(
        {
            addFeature: _addFeature,
            clearActiveFeatures: _clearActiveFeatures,
            removeActiveFeature: _removeActiveFeature,
            updateColorScale: _updateColorScale,
            updateColorScaleThresholds: _updateColorScaleThresholds,
            updateColorScaleType: _updateColorScaleType,
        },
        useAppDispatch()
    );

    const resetOverlay = clearActiveFeatures;

    const removeFeature = (featureName: string) => {
        removeActiveFeature(featureName);
        const domain = getScaleCombinations(
            activeFeatures.filter(f => f !== featureName)
        );

        const range = interpolateColorScale(domain);

        updateColorScale({ range, domain });

        if (activeFeatures.length === 1) {
            updateColorScaleType('labelCount');
        }
    };

    const getFeature = async (feature: string) => {
        setLoading(true);
        const features = await fetchFeatures(feature);
        const featureMap: Record<string, number> = {};

        features.forEach(f => {
            featureMap[f.id] = f.value;
        });

        addFeature({ key: feature, map: featureMap });

        updateColorScaleType('featureCount');

        const domain = getScaleCombinations(
            activeFeatures.filter(Boolean).concat(feature)
        );

        const range = interpolateColorScale(domain);

        updateColorScale({ range, domain });

        setLoading(false);
    };

    useEffect(() => {
        fetchFeatureNames().then(f => {
            setFeatureList(f);
        });
    }, []);

    return (
        <Column>
            <SearchTitle>Feature Search</SearchTitle>
            <Caption>Search for a feature by identifier</Caption>
            <Autocomplete
                resetOverlay={resetOverlay}
                options={featureList || []}
                onSelect={getFeature}
            />

            {!!activeFeatures.length && (
                <>
                    <FeatureListContainer>
                        <FeatureListLabel>Selected Features</FeatureListLabel>
                        <FeatureList>
                            {getEntries(featureThresholds)
                                .filter(([k, _]) => activeFeatures.includes(k))
                                .map(([k, v]) => (
                                    <FeatureSlider
                                        key={k}
                                        featureName={k}
                                        featureStats={featureDistributions[k]}
                                        highLowThreshold={v}
                                        removeFeature={removeFeature}
                                        updateThreshold={(val: number) =>
                                            updateColorScaleThresholds({
                                                [k]: val,
                                            })
                                        }
                                    />
                                ))}
                        </FeatureList>
                    </FeatureListContainer>
                </>
            )}

            <Modal open={loading} message="Loading..." />
        </Column>
    );
};

const SearchTitle = styled(Title)`
    margin: 0px;
`;

const FeatureListContainer = styled(Column)`
    position: relative;
    margin: 0px 0px;
`;

const FeatureList = styled(Row)`
    border: thin black solid;
    border-radius: 3px;
    flex-wrap: wrap;
    padding: 8px;
    margin: 5px 0px;
`;

const FeatureListLabel = styled(Caption)`
    background-color: white;
    position: absolute;
`;

interface FeaturePillProps {
    count: string;
    name: string;
    removeFeature: (featureName: string) => void;
}

const FeaturePill: React.FC<FeaturePillProps> = ({
    removeFeature,
    name,
    count,
}) => (
    <FeaturePillContainer>
        {name}: {count}
        <RemoveFeatureIcon
            onClick={removeFeature.bind(null, name)}
            strokeWidth={10}
            pointer
            stroke="white"
            size="7px"
        />
    </FeaturePillContainer>
);

const RemoveFeatureIcon = styled(CloseIcon)`
    padding: 3px;
`;

const FeaturePillContainer = styled.span`
    align-items: flex-start;
    background-color: ${props => props.theme.palette.primary};
    border-radius: 7px;
    color: white;
    display: flex;
    margin: 3px;
    padding: 4px;
`;

interface FeatureSliderProps {
    featureName: string;
    featureStats: FeatureDistribution;
    highLowThreshold: number;
    removeFeature: (featureName: string) => void;
    updateThreshold: (newThreshold: number) => void;
}

const FeatureSlider: React.FC<FeatureSliderProps> = ({
    featureName,
    featureStats,
    highLowThreshold,
    removeFeature,
    updateThreshold,
}) => {
    const [rangeType, setRangeType] = useState<'mad' | 'raw'>('raw');
    const [includeZeroes, setIncludeZeroes] = useState(false);

    const {
        mad: _mad,
        madWithZeroes,
        max,
        median: _median,
        medianWithZeroes,
    } = featureStats;

    const mad = useMemo(() => {
        return includeZeroes ? madWithZeroes : _mad;
    }, [includeZeroes, madWithZeroes, _mad]);

    const median = useMemo(() => {
        return includeZeroes ? medianWithZeroes : _median;
    }, [includeZeroes, madWithZeroes, _median]);

    const madRange = useMemo(() => {
        if (mad !== undefined) {
            return range(median, max, mad);
        } else {
            return [];
        }
    }, [featureStats, includeZeroes]);

    return (
        <Column>
            <Row margin="2px">
                <FeaturePill
                    count={featureStats.total.toString()}
                    name={featureName}
                    removeFeature={removeFeature}
                />
            </Row>
            <Row margin="2px">High/Low Threshold: {highLowThreshold}</Row>
            {rangeType === 'mad' && (
                <Row alignItems="center" margin="2px">
                    MAD: {mad}
                    {rangeType === 'mad' && (
                        <Checkbox
                            checked={includeZeroes}
                            label="Include Zeroes"
                            onClick={() => setIncludeZeroes(!includeZeroes)}
                            style={{ marginLeft: '5px' }}
                        />
                    )}
                </Row>
            )}
            <Row alignItems="center" margin="2px">
                <RadioGroup>
                    <RadioButton
                        checked={rangeType === 'raw'}
                        id="rawRange"
                        name="rawRange"
                        onChange={() => setRangeType('raw')}
                        type="radio"
                    />
                    <RadioLabel htmlFor="rawRange">Raw</RadioLabel>
                    <RadioButton
                        checked={rangeType === 'mad'}
                        id="madRange"
                        name="madRange"
                        onChange={() => setRangeType('mad')}
                        type="radio"
                    />
                    <RadioLabel htmlFor="madRange">MAD</RadioLabel>
                </RadioGroup>
            </Row>
            <Row alignItems="center" margin="2px">
                <span>{rangeType === 'raw' ? featureStats.min : 0}</span>
                <input
                    type="range"
                    max={
                        rangeType === 'raw'
                            ? featureStats.max
                            : madRange?.length
                    }
                    min={rangeType === 'raw' ? featureStats.min : 0}
                    step={1}
                    value={
                        rangeType === 'raw'
                            ? highLowThreshold
                            : highLowThreshold / mad - median
                    }
                    onChange={v =>
                        updateThreshold(
                            rangeType === 'raw'
                                ? +v.currentTarget.value
                                : median + +v.currentTarget.value * mad
                        )
                    }
                />
                <span>
                    {rangeType === 'raw' ? featureStats.max : madRange?.length}
                </span>
                <NumberInput
                    onChange={v =>
                        updateThreshold(
                            rangeType === 'raw' ? +v : median + +v * mad
                        )
                    }
                    style={{ marginLeft: '3px' }}
                    value={
                        rangeType === 'raw'
                            ? highLowThreshold
                            : (highLowThreshold - median) / mad
                    }
                />
            </Row>
        </Column>
    );
};

interface AutocompleteProps {
    options: string[];
    onSelect: (feature: string) => void;
    resetOverlay: () => void;
}

const Autocomplete: React.FC<AutocompleteProps> = ({
    options,
    onSelect,
    resetOverlay,
}) => {
    const [choices, setChoices] = useState<string[]>([]);
    const [choicesVisible, setChoicesVisible] = useState(false);
    const [minVisibleIdx, setMinVisibleIdx] = useState(0);
    const [search, setSearch] = useState('');
    const [selectedIdx, setSelectedIdx] = useState<number>(0);

    const maxVisible = useMemo(() => 10, []);

    const parentWidth = useRef<string>('0px');
    const inputRef =
        useRef<HTMLInputElement>() as MutableRefObject<HTMLInputElement>;
    const containerRef =
        useRef<HTMLDivElement>() as MutableRefObject<HTMLDivElement>;

    useClickAway(containerRef, () => setChoicesVisible(false));

    /* Adjust the visible choices */
    useEffect(() => {
        if (choices.length) {
            if (selectedIdx - maxVisible === minVisibleIdx) {
                if (selectedIdx === options.length) {
                    setMinVisibleIdx(0);
                } else {
                    setMinVisibleIdx(minVisibleIdx + 1);
                }
            } else if (selectedIdx < minVisibleIdx) {
                if (selectedIdx === 0) {
                    setMinVisibleIdx(0);
                } else {
                    setMinVisibleIdx(minVisibleIdx - 1);
                }
            }
        }
    }, [selectedIdx]);

    useEffect(() => {
        if (inputRef.current) {
            parentWidth.current = inputRef.current.clientWidth - 5 + 'px';
        }
    }, [inputRef.current]);

    useEffect(() => {
        setChoices(
            options
                .map(o => ({
                    word: o,
                    distance: levenshtein(
                        o.toLowerCase(),
                        search.toLowerCase()
                    ),
                }))
                .sort((a, b) => (a.distance < b.distance ? -1 : 1))
                .map(d => d.word)
        );
        setSelectedIdx(0);
    }, [options, search]);

    const resetInputs = () => {
        setChoices([]);
        setSearch('');
        setChoicesVisible(false);
        setMinVisibleIdx(0);
        setSelectedIdx(0);
    };

    const _resetOverlay = () => {
        resetOverlay();
        resetInputs();
    };

    const select = (choice: string) => {
        onSelect(choice);
        resetInputs();
    };

    const handleKeyPress = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.code === 'ArrowUp') {
            const nextIdx = selectedIdx === 0 ? 0 : selectedIdx - 1;
            return setSelectedIdx(nextIdx);
        } else if (e.code === 'ArrowDown') {
            const nextIdx = (selectedIdx + 1) % options.length;
            return setSelectedIdx(nextIdx);
        } else if (e.code === 'Escape') {
            resetInputs();
        } else if (e.code === 'Enter') {
            if (selectedIdx > -1) {
                select(choices[selectedIdx]);
            }
        }
    };

    const getIsSelected = (idx: number) => {
        const isSelected = minVisibleIdx + idx === selectedIdx;
        return isSelected;
    };

    return (
        <Row alignItems="center" margin="0px" style={{ marginTop: '5px' }}>
            <AutocompleteContainer width="auto" ref={containerRef}>
                <AutocompleteInput
                    ref={inputRef}
                    handleKeyPress={handleKeyPress}
                    onChange={e => {
                        setSearch(e.currentTarget.value);
                        setChoicesVisible(true);
                    }}
                    onClick={() => setChoicesVisible(true)}
                    value={search}
                />
                <AutocompleteChoicesContainer _width={parentWidth.current}>
                    {choicesVisible &&
                        choices
                            .slice(minVisibleIdx, minVisibleIdx + maxVisible)
                            .map((c, i) => (
                                <Choice
                                    onClick={() => select(c)}
                                    selected={getIsSelected(i)}
                                    key={c}
                                >
                                    {c}
                                </Choice>
                            ))}
                </AutocompleteChoicesContainer>
            </AutocompleteContainer>
            <Button onClick={_resetOverlay}>Reset</Button>
        </Row>
    );
};

interface AutocompleteInputProps extends InputHTMLAttributes<any> {
    handleKeyPress: (e: KeyboardEvent<HTMLInputElement>) => void;
    ref: React.Ref<HTMLInputElement>;
}

const AutocompleteInput: React.FC<AutocompleteInputProps> = forwardRef(
    (props: AutocompleteInputProps, ref: ForwardedRef<HTMLInputElement>) => {
        const { handleKeyPress, ...rest } = props;
        return <Input {...rest} ref={ref} onKeyDownCapture={handleKeyPress} />;
    }
);

AutocompleteInput.displayName = 'Autocomplete Input';

const AutocompleteContainer = styled(Column)`
    flex-grow: 0;
    margin-right: 5px;
    position: relative;
`;

const AutocompleteChoicesContainer = styled(Column)<{ _width: string }>`
    border-radius: 5px;
    position: absolute;
    top: 25px;
    width: ${props => props._width};
`;

const Choice = styled.span<{ selected: boolean }>`
    background-color: ${props =>
        props.selected
            ? props.theme.palette.secondary
            : props.theme.palette.primary};
    color: white;
    cursor: pointer;
    padding: 3px;
    width: 100%;
    &:hover {
        background-color: ${props => props.theme.palette.secondary};
    }
    z-index: 10;
`;

export default FeatureSearch;
