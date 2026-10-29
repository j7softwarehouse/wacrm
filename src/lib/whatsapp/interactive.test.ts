import { describe, expect, it } from 'vitest'

import {
  validateInteractivePayload,
  validateBuilderPayload,
  interactivePayloadPreviewText,
  type InteractiveButtonsPayload,
  type InteractiveListPayload,
} from './interactive'

const validButtons: InteractiveButtonsPayload = {
  kind: 'buttons',
  body: 'Choose an option',
  buttons: [
    { id: 'yes', title: 'Yes' },
    { id: 'no', title: 'No' },
  ],
}

const validList: InteractiveListPayload = {
  kind: 'list',
  body: 'Pick a service',
  button_label: 'View menu',
  sections: [
    {
      title: 'Services',
      rows: [
        { id: 'seo', title: 'SEO', description: 'Search optimization' },
        { id: 'ads', title: 'Ads' },
      ],
    },
  ],
}

describe('validateInteractivePayload — buttons', () => {
  it('accepts a well-formed buttons payload', () => {
    expect(validateInteractivePayload(validButtons)).toEqual({ ok: true })
  })

  it('rejects a missing/empty payload', () => {
    expect(validateInteractivePayload(undefined).ok).toBe(false)
    expect(validateInteractivePayload(null).ok).toBe(false)
  })

  it('requires a non-empty body within 1024 chars', () => {
    expect(validateInteractivePayload({ ...validButtons, body: '' }).ok).toBe(false)
    const long = validateInteractivePayload({ ...validButtons, body: 'x'.repeat(1025) })
    expect(long.ok).toBe(false)
  })

  it('requires 1-3 buttons', () => {
    expect(validateInteractivePayload({ ...validButtons, buttons: [] }).ok).toBe(false)
    const four = validateInteractivePayload({
      ...validButtons,
      buttons: [
        { id: 'a', title: 'A' },
        { id: 'b', title: 'B' },
        { id: 'c', title: 'C' },
        { id: 'd', title: 'D' },
      ],
    })
    expect(four.ok).toBe(false)
  })

  it('caps button title at 20 chars', () => {
    const res = validateInteractivePayload({
      ...validButtons,
      buttons: [{ id: 'a', title: 'x'.repeat(21) }],
    })
    expect(res.ok).toBe(false)
  })

  it('rejects duplicate button ids', () => {
    const res = validateInteractivePayload({
      ...validButtons,
      buttons: [
        { id: 'dup', title: 'A' },
        { id: 'dup', title: 'B' },
      ],
    })
    expect(res).toEqual({ ok: false, error: 'Duplicate button id "dup".' })
  })

  it('rejects empty button id / title', () => {
    expect(
      validateInteractivePayload({ ...validButtons, buttons: [{ id: '', title: 'A' }] }).ok,
    ).toBe(false)
    expect(
      validateInteractivePayload({ ...validButtons, buttons: [{ id: 'a', title: '' }] }).ok,
    ).toBe(false)
  })
})

describe('validateInteractivePayload — list', () => {
  it('accepts a well-formed list payload', () => {
    expect(validateInteractivePayload(validList)).toEqual({ ok: true })
  })

  it('requires a button label within 20 chars', () => {
    expect(validateInteractivePayload({ ...validList, button_label: '' }).ok).toBe(false)
    expect(
      validateInteractivePayload({ ...validList, button_label: 'x'.repeat(21) }).ok,
    ).toBe(false)
  })

  it('caps total rows at 10 across sections', () => {
    const rows = Array.from({ length: 11 }, (_, i) => ({ id: `r${i}`, title: `Row ${i}` }))
    const res = validateInteractivePayload({
      ...validList,
      sections: [{ rows }],
    })
    expect(res.ok).toBe(false)
  })

  it('caps list row title at 24 chars', () => {
    const res = validateInteractivePayload({
      ...validList,
      sections: [{ rows: [{ id: 'r', title: 'x'.repeat(25) }] }],
    })
    expect(res.ok).toBe(false)
  })

  it('rejects duplicate row ids across sections', () => {
    const res = validateInteractivePayload({
      ...validList,
      sections: [
        { rows: [{ id: 'dup', title: 'A' }] },
        { rows: [{ id: 'dup', title: 'B' }] },
      ],
    })
    expect(res.ok).toBe(false)
  })
})

describe('interactivePayloadPreviewText', () => {
  it('returns the trimmed body', () => {
    expect(interactivePayloadPreviewText({ ...validButtons, body: '  Hi  ' })).toBe('Hi')
  })
  it('falls back when body is blank', () => {
    expect(interactivePayloadPreviewText({ ...validButtons, body: '   ' })).toBe('[buttons]')
    expect(interactivePayloadPreviewText({ ...validList, body: '' })).toBe('[list]')
  })
})

describe('poll payload', () => {
  const validPoll = {
    kind: 'poll' as const,
    body: 'Qual horário?',
    options: ['Manhã', 'Tarde'],
    selectable_count: 1,
  }

  it('accepts a 2-option single-choice poll', () => {
    expect(validateInteractivePayload(validPoll).ok).toBe(true)
  })
  it('needs at least 2 options and at most 12', () => {
    expect(validateInteractivePayload({ ...validPoll, options: ['Só uma'] }).ok).toBe(false)
    const thirteen = Array.from({ length: 13 }, (_, i) => `op${i}`)
    expect(validateInteractivePayload({ ...validPoll, options: thirteen }).ok).toBe(false)
  })
  it('rejects duplicate options ignoring case and spaces', () => {
    const res = validateInteractivePayload({ ...validPoll, options: ['Sim', ' sim '] })
    expect(res.ok).toBe(false)
  })
  it('keeps selectable_count between 1 and the number of options', () => {
    expect(validateInteractivePayload({ ...validPoll, selectable_count: 0 }).ok).toBe(false)
    expect(validateInteractivePayload({ ...validPoll, selectable_count: 3 }).ok).toBe(false)
    expect(validateInteractivePayload({ ...validPoll, selectable_count: 2 }).ok).toBe(true)
  })
  it('caps the question at 255 chars', () => {
    expect(validateInteractivePayload({ ...validPoll, body: 'x'.repeat(256) }).ok).toBe(false)
  })
  it('is refused as a saved quick reply or automation step', () => {
    expect(validateBuilderPayload(validPoll).ok).toBe(false)
    expect(validateBuilderPayload(validButtons).ok).toBe(true)
  })
  it('previews as [poll] when the question is blank', () => {
    expect(interactivePayloadPreviewText({ ...validPoll, body: '' })).toBe('[poll]')
  })
})
