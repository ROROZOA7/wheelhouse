// Injected into every page the recorder opens (context.addInitScript).
// Draws a fake cursor, click rings, a caption card and full-screen title cards, all in a
// shadow root on <html> so Wheelhouse's own styles and Svelte's re-renders never touch them.
// Colours and fonts come from Wheelhouse's CSS variables, so the overlay follows its look.
(() => {
	if (window.__guide) return;
	const css = `
	:host { all: initial; }
	.cursor { position: fixed; left: 0; top: 0; width: 22px; height: 22px; z-index: 3; pointer-events: none;
		transform: translate(-100px, -100px); transition: opacity 200ms; filter: drop-shadow(0 1px 1.5px rgb(0 0 0 / .35)); }
	.cursor.hidden { opacity: 0; }
	.ring { position: fixed; z-index: 2; width: 34px; height: 34px; margin: -17px 0 0 -17px; border-radius: 50%;
		border: 2px solid var(--sea, #23607f); pointer-events: none; animation: ring 520ms ease-out forwards; }
	@keyframes ring { from { transform: scale(.35); opacity: .9; } to { transform: scale(1.25); opacity: 0; } }
	.cap { position: fixed; left: 32px; bottom: 30px; z-index: 1; max-width: 600px; pointer-events: none;
		background: var(--primary, #14213d); color: var(--primary-foreground, #fbf8f1);
		border-left: 3px solid var(--brass, #a88734); border-radius: 6px; padding: 12px 18px 14px;
		box-shadow: 0 6px 24px rgb(20 33 61 / .28); opacity: 0; transform: translateY(8px);
		transition: opacity 320ms ease, transform 320ms ease; }
	.cap.right { left: auto; right: 32px; }
	.cap.on { opacity: 1; transform: none; }
	.cap .k { font: 600 11px/1 var(--font-sans, Inter, sans-serif); letter-spacing: .14em; text-transform: uppercase;
		color: var(--brass, #a88734); margin-bottom: 7px; }
	.cap .t { font: 400 21px/1.3 var(--font-display, Georgia, serif); }
	.title { position: fixed; inset: 0; z-index: 4; display: flex; flex-direction: column; justify-content: center;
		padding: 0 120px; background: #14213d; color: #fbf8f1; opacity: 0; transition: opacity 600ms ease; pointer-events: none;
		background-image: linear-gradient(rgb(251 248 241 / .035) 1px, transparent 1px),
			linear-gradient(90deg, rgb(251 248 241 / .035) 1px, transparent 1px); background-size: 24px 24px; }
	.title.on { opacity: 1; }
	.title .k { font: 600 13px/1 var(--font-sans, Inter, sans-serif); letter-spacing: .2em; text-transform: uppercase; color: #a88734; }
	.title .h { font: 400 72px/1.05 var(--font-display, Georgia, serif); margin: 18px 0 16px; }
	.title .s { font: 400 24px/1.4 var(--font-sans, Inter, sans-serif); color: rgb(251 248 241 / .78); max-width: 760px; }
	.title .s code { font: 400 21px/1.4 var(--font-mono, monospace); color: #fbf8f1; background: rgb(251 248 241 / .08);
		padding: 4px 10px; border-radius: 4px; }
	.title .rule { width: 72px; height: 2px; background: #a88734; margin-top: 30px; }
	`;
	const arrow = `<svg viewBox="0 0 22 22" width="22" height="22"><path d="M3 2 L3 18.5 L7.4 14.6 L10.3 21 L13.2 19.7 L10.4 13.4 L16.3 13.2 Z"
		fill="#14213d" stroke="#fbf8f1" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
	let host, root, cursor, cap, title;
	let state = { caption: null, cursor: true, x: -100, y: -100 };
	function mount() {
		if (host?.isConnected) return;
		host = document.createElement('wh-guide-overlay');
		host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
		root = host.attachShadow({ mode: 'open' });
		root.innerHTML = `<style>${css}</style><div class="cap"><div class="k"></div><div class="t"></div></div>
			<div class="title"><div class="k"></div><div class="h"></div><div class="s"></div><div class="rule"></div></div>
			<div class="cursor">${arrow}</div>`;
		cursor = root.querySelector('.cursor');
		cap = root.querySelector('.cap');
		title = root.querySelector('.title');
		document.documentElement.appendChild(host);
		place(state.x, state.y);
		cursor.classList.toggle('hidden', !state.cursor);
		if (state.caption) setCaption(state.caption, true);
	}
	function place(x, y) {
		state.x = x;
		state.y = y;
		if (cursor) cursor.style.transform = `translate(${x - 3}px, ${y - 2}px)`;
	}
	function setCaption(c, instant) {
		state.caption = c;
		if (!cap) return;
		if (!c) return cap.classList.remove('on');
		const show = () => {
			cap.querySelector('.k').textContent = c.kicker ?? '';
			cap.querySelector('.t').textContent = c.text;
			cap.classList.toggle('right', c.side === 'right');
			cap.classList.add('on');
		};
		if (instant || !cap.classList.contains('on')) return show();
		cap.classList.remove('on');
		setTimeout(show, 330);
	}
	addEventListener('mousemove', (e) => place(e.clientX, e.clientY), true);
	addEventListener(
		'mousedown',
		(e) => {
			const r = document.createElement('div');
			r.className = 'ring';
			r.style.left = `${e.clientX}px`;
			r.style.top = `${e.clientY}px`;
			root?.appendChild(r);
			setTimeout(() => r.remove(), 600);
		},
		true
	);
	window.__guide = {
		caption: (c) => (mount(), setCaption(c)),
		cursor: (on) => {
			state.cursor = on;
			mount();
			cursor.classList.toggle('hidden', !on);
		},
		title: (t) => {
			mount();
			if (!t) return title.classList.remove('on');
			title.querySelector('.k').textContent = t.kicker ?? '';
			title.querySelector('.h').textContent = t.heading;
			title.querySelector('.s').innerHTML = t.sub ?? '';
			title.classList.add('on');
		},
		state: () => state,
		restore: (s) => {
			state = { ...state, ...s };
			mount();
		}
	};
	if (document.readyState === 'loading') addEventListener('DOMContentLoaded', mount);
	else mount();
	// Svelte or a full reload can drop the host; put it back.
	setInterval(mount, 250);
})();
