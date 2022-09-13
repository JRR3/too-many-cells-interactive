import React from 'react';
import { bindActionCreators } from 'redux';
import { NumberInput } from '../../Input';
import { Column, Row } from '../../Layout';
import { Label } from '../../Typography';
import { selectFeatureSlice } from '../../../redux/featureSlice';
import FeatureSearch from '../FeatureSearch/FeatureSearch';
import { useAppDispatch, useAppSelector } from '../../../hooks';
import {
    activateFeatureColorScale as _activateContinuousFeatureScale,
    selectDisplayConfig,
    updateColorScale as _updateColorScale,
    updateColorScaleType as _updateColorScaleType,
    updateLinearScale as _updateLinearScale,
} from '../../../redux/displayConfigSlice';
import { RadioButton, RadioGroup, RadioLabel } from '../../Radio';
import {
    addGray,
    getScaleCombinations,
    interpolateColorScale,
} from '../../../util';
import DisplaySettings from './DisplaySettings';
import ExportControls from './ExportControls';
import PrunerPanel from './PrunerPanel';
import Legend from './Legend';

const DisplayControls: React.FC = () => {
    const {
        scales: {
            branchSizeScale,
            colorScale: {
                variant: colorScaleType,
                featureGradientScaleType,
                featureScaleSaturation,
            },
            pieScale,
        },
    } = useAppSelector(selectDisplayConfig);

    const {
        activateContinuousFeatureScale,
        updateColorScale,
        updateColorScaleType,
        updateLinearScale,
    } = bindActionCreators(
        {
            activateContinuousFeatureScale: _activateContinuousFeatureScale,
            updateColorScale: _updateColorScale,
            updateColorScaleType: _updateColorScaleType,
            updateLinearScale: _updateLinearScale,
        },
        useAppDispatch()
    );

    const handleScaleSilderChange =
        (scaleType: 'branchSizeScale' | 'pieScale') =>
        (value: number | undefined) => {
            const scale =
                scaleType === 'branchSizeScale' ? branchSizeScale : pieScale;
            updateLinearScale({
                [scaleType]: {
                    range: [scale.range[0], value],
                },
            });
        };

    const { activeFeatures } = useAppSelector(selectFeatureSlice);

    const changeScaleType = (scaleType: typeof colorScaleType) => {
        updateColorScaleType(scaleType);
    };

    const activateOrdinalFeatureScale = () => {
        updateColorScaleType('featureHiLos');
        const featureHiLoDomain = getScaleCombinations(
            activeFeatures.filter(Boolean)
        );
        const featureHiLoRange = addGray(
            featureHiLoDomain,
            interpolateColorScale(featureHiLoDomain)
        );
        updateColorScale({
            featureHiLoDomain,
            featureHiLoRange,
        });
    };

    return (
        <>
            <Column xs={6}>
                {!!activeFeatures.length && (
                    <Row>
                        <RadioGroup>
                            <RadioButton
                                checked={colorScaleType === 'featureHiLos'}
                                id='featureHiLos'
                                name='featureHiLos'
                                onChange={activateOrdinalFeatureScale}
                                type='radio'
                            />
                            <RadioLabel htmlFor='featureHiLos'>
                                Feature HiLo
                            </RadioLabel>
                            <RadioButton
                                checked={colorScaleType === 'labelCount'}
                                id='labelCount'
                                name='labelCount'
                                onChange={changeScaleType.bind(
                                    null,
                                    'labelCount'
                                )}
                                type='radio'
                            />
                            <RadioLabel htmlFor='labelCount'>Labels</RadioLabel>
                            <RadioButton
                                checked={
                                    colorScaleType === 'featureAverage' &&
                                    featureGradientScaleType === 'sequential'
                                }
                                id='two-color'
                                name='two-color'
                                onChange={() =>
                                    activateContinuousFeatureScale('sequential')
                                }
                                type='radio'
                            />
                            <RadioLabel htmlFor='two-color'>
                                Feature Avg
                            </RadioLabel>
                            <RadioButton
                                checked={
                                    colorScaleType === 'featureAverage' &&
                                    featureGradientScaleType ===
                                        'symlogSequential'
                                }
                                id='two-color-sym'
                                name='two-color-sym'
                                onChange={() =>
                                    activateContinuousFeatureScale(
                                        'symlogSequential'
                                    )
                                }
                                type='radio'
                            />
                            <RadioLabel htmlFor='two-color-sym'>
                                Feature Avg SymLog
                            </RadioLabel>
                        </RadioGroup>
                    </Row>
                )}
                <Row>
                    <Legend />
                </Row>

                <Row>
                    <DisplaySettings />
                </Row>
                <Row>
                    <Column xs={12}>
                        <Slider
                            label='Adjust Max Width'
                            max={50}
                            min={branchSizeScale.range[0]}
                            onChange={handleScaleSilderChange(
                                'branchSizeScale'
                            )}
                            value={branchSizeScale.range[1]}
                        />
                        <Slider
                            label='Adjust Max Pie Size'
                            max={50}
                            min={pieScale.range[0]}
                            onChange={handleScaleSilderChange('pieScale')}
                            value={pieScale.range[1]}
                        />
                        {['featureAverage', 'featureHiLos'].includes(
                            colorScaleType
                        ) && (
                            <Slider
                                label='Adjust Saturation'
                                max={5}
                                min={0}
                                onChange={featureScaleSaturation =>
                                    updateColorScale({
                                        featureScaleSaturation,
                                    })
                                }
                                step={0.1}
                                value={featureScaleSaturation ?? 0}
                            />
                        )}
                    </Column>
                </Row>
            </Column>
            <Column xs={6}>
                <Row>
                    <ExportControls />
                </Row>
                <Row>
                    <PrunerPanel />
                </Row>
                <Row>
                    <FeatureSearch />
                </Row>
            </Column>
        </>
    );
};

export default DisplayControls;

interface SliderProps {
    label: string;
    min: number;
    max: number;
    onChange: (val: number | undefined) => void;
    step?: number;
    value: number;
}

const Slider: React.FC<SliderProps> = ({
    label,
    max,
    min,
    onChange,
    step,
    value,
}) => {
    return (
        <Row>
            <Column xs={12}>
                <Row>
                    <Label>{label}</Label>
                </Row>
                <Row>
                    <input
                        type='range'
                        max={max}
                        min={min}
                        step={step || 1}
                        value={value}
                        onChange={e => onChange(+e.currentTarget.value)}
                    />
                    <NumberInput
                        ml='10px'
                        onChange={v => onChange(v)}
                        value={value}
                        width='50px'
                    />
                </Row>
            </Column>
        </Row>
    );
};
