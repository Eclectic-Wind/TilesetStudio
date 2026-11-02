// Page-only helpers shared by the interface scripts (the processing worker never loads this).
"use strict";
var TS = window.TS || (window.TS = {});

// localStorage that shrugs when the browser blocks it: reads give null, writes aren't remembered.
TS.store = {
	get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
	set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage blocked or full */ } },
	remove(k) { try { localStorage.removeItem(k); } catch (e) { /* storage blocked */ } },
	json(k) { try { return JSON.parse(TS.store.get(k)); } catch (e) { return null; } },
};

TS.esc = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
