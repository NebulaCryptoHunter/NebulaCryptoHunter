import assert from 'node:assert/strict';
import {Script} from 'node:vm';

// Optional UI enhancements can use independent scripts. Validate every block
// and reject unclosed/source-leaking tags instead of assuming one script.
export function assertFrontendScripts(html){
 const scripts=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)];
 assert.ok(scripts.length>0,'Frontend must contain executable scripts');
 assert.equal(scripts.length,(html.match(/<script\b/g)||[]).length,'Every script must have a closing tag');
 for(const [,source] of scripts)new Script(source);
}
