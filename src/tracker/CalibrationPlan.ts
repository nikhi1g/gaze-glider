import type { Point2D } from '../types';

export interface CalibrationTarget extends Point2D {
  id: string;
  phase: 'screen' | 'head-range' | 'validation';
  instruction: string;
  settleMs: number;
  collectMs: number;
}

const screenPoints: Array<[number, number]> = [
  [0.06, 0.06],
  [0.5, 0.06],
  [0.94, 0.06],
  [0.06, 0.25],
  [0.25, 0.25],
  [0.5, 0.25],
  [0.75, 0.25],
  [0.94, 0.25],
  [0.06, 0.5],
  [0.5, 0.5],
  [0.94, 0.5],
  [0.06, 0.75],
  [0.25, 0.75],
  [0.5, 0.75],
  [0.75, 0.75],
  [0.94, 0.75],
  [0.5, 0.94],
];

export function getCalibrationPlan(): CalibrationTarget[] {
  const screenTargets = screenPoints.map(([x, y], index) => ({
    id: `screen-${index + 1}`,
    x,
    y,
    phase: 'screen' as const,
    instruction: 'Keep your head comfortable and look at the dot.',
    settleMs: 360,
    collectMs: 680,
  }));

  const headRangeTargets: CalibrationTarget[] = [
    {
      id: 'head-neutral',
      x: 0.5,
      y: 0.5,
      phase: 'head-range',
      instruction: 'Keep looking at the center in your normal position.',
      settleMs: 380,
      collectMs: 760,
    },
    {
      id: 'head-left',
      x: 0.5,
      y: 0.5,
      phase: 'head-range',
      instruction: 'Keep looking at the center and shift your head slightly left.',
      settleMs: 500,
      collectMs: 820,
    },
    {
      id: 'head-right',
      x: 0.5,
      y: 0.5,
      phase: 'head-range',
      instruction: 'Keep looking at the center and shift your head slightly right.',
      settleMs: 500,
      collectMs: 820,
    },
    {
      id: 'head-near',
      x: 0.5,
      y: 0.5,
      phase: 'head-range',
      instruction: 'Keep looking at the center and lean slightly closer.',
      settleMs: 500,
      collectMs: 820,
    },
    {
      id: 'head-far',
      x: 0.5,
      y: 0.5,
      phase: 'head-range',
      instruction: 'Keep looking at the center and lean slightly farther away.',
      settleMs: 500,
      collectMs: 820,
    },
  ];

  return [...screenTargets, ...headRangeTargets];
}

export function getValidationPlan(): CalibrationTarget[] {
  const validationPoints: Array<[number, number]> = [
    [0.15, 0.15],
    [0.85, 0.15],
    [0.5, 0.5],
    [0.15, 0.85],
    [0.85, 0.85],
  ];

  return validationPoints.map(([x, y], index) => ({
    id: `validation-${index + 1}`,
    x,
    y,
    phase: 'validation' as const,
    instruction: 'Look at the dot while accuracy is checked.',
    settleMs: 320,
    collectMs: 560,
  }));
}
