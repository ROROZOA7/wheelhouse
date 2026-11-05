import { describe, expect, it } from 'vitest';
import { batchText, pluginBatchText } from '../previewhelper';
import type { BridgeMessage } from '../types';
import { chatBatches, placeBatches } from './batches';
import type { Item } from './fold';

const at = (m: string) => `2026-11-03T09:${m}:00.000Z`;
const msg = (o: Partial<BridgeMessage>): BridgeMessage => ({
	requestId: 'r1',
	text: batchText({ id: 'lumen-share', title: 'Share links' }, 'http://127.0.0.1:5240/', [
		{ text: 'Make links last 30 days' }
	]),
	taskId: 'lumen-share',
	submittedAt: at('10'),
	delivery: 'delivered',
	deliveryDetail: null,
	acknowledged: null,
	noteId: null,
	reply: null,
	...o
});

describe('chatBatches', () => {
	it('keeps only the feedback lists, saying whether Firstmate has each and its reply', () => {
		const out = chatBatches([
			msg({}),
			msg({ requestId: 'r2', text: 'An ordinary note' }),
			msg({ requestId: 'r3', acknowledged: true, reply: { body: 'Passed on.', at: null } }),
			msg({ requestId: 'r4', delivery: 'failed' })
		]);
		expect(out.map((b) => [b.id, b.status, b.failed, b.reply])).toEqual([
			['r1', 'Sent to Firstmate', false, null],
			['r3', 'Firstmate has it and passes it to the same task', false, 'Passed on.'],
			['r4', 'Not delivered', true, null]
		]);
		expect(out[0].batch.items).toEqual([{ text: 'Make links last 30 days', points: null }]);
	});

	it('keeps a plugin’s feedback list too, with the plugin that sent it', () => {
		const text = pluginBatchText(
			{ id: 'lumen-plan', title: 'Plan' },
			{ id: 'plan-review', name: 'Plan review' },
			'plan.md',
			[{ text: 'Add a rollback step', points: 'line 12' }]
		);
		const [b] = chatBatches([msg({ text, taskId: 'lumen-plan' })]);
		expect(b.batch.plugin).toEqual({ id: 'plan-review', name: 'Plan review', subject: 'plan.md' });
		expect(b.batch.items).toEqual([{ text: 'Add a rollback step', points: 'line 12' }]);
	});
});

describe('placeBatches', () => {
	it('puts each list before the first message after it, newer ones last, older ones out', () => {
		const items = [{ at: at('05') }, { at: at('20') }] as Item[];
		const [mid, late, early] = chatBatches([
			msg({ requestId: 'mid', submittedAt: at('10') }),
			msg({ requestId: 'late', submittedAt: at('30') }),
			msg({ requestId: 'early', submittedAt: at('01') })
		]);
		const p = placeBatches(items, [mid, late, early]);
		expect([...p.before.entries()].map(([i, bs]) => [i, bs.map((b) => b.id)])).toEqual([
			[1, ['mid']]
		]);
		expect(p.end.map((b) => b.id)).toEqual(['late']);
	});
});
