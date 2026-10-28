/**
 * Banner markup and client script. Pure functions so they can be tested without EmDash.
 *
 * Consent is stored in a first-party cookie, `cms_consent=<revision>:<categories>`, e.g.
 * `1:analytics,marketing` or `1:` (necessary only). Bumping the revision in settings re-asks
 * every visitor, which is what a policy change needs.
 *
 * Sites gate scripts by marking them inert until consent:
 *   <script type="text/plain" data-consent="analytics" src="https://…"></script>
 * The client script activates them when their category is granted.
 */

export const CATEGORIES = ["analytics", "marketing"] as const;

export interface ConsentSettings {
	enabled: boolean;
	title: string;
	message: string;
	policyUrl: string;
	policyLabel: string;
	acceptLabel: string;
	rejectLabel: string;
	manageLabel: string;
	position: "bottom" | "bottom-left";
	revision: number;
	googleConsentMode: boolean;
}

export const DEFAULTS: ConsentSettings = {
	enabled: true,
	title: "Cookies on this site",
	message: "We use essential cookies to make this site work. With your permission we'd also like to use analytics and marketing cookies to understand how the site is used.",
	policyUrl: "",
	policyLabel: "Cookie policy",
	acceptLabel: "Accept all",
	rejectLabel: "Reject non-essential",
	manageLabel: "Manage preferences",
	position: "bottom",
	revision: 1,
	googleConsentMode: false,
};

/** Merge stored settings over config options over defaults, dropping values of the wrong type. */
export function resolveSettings(...layers: Array<Partial<Record<keyof ConsentSettings, unknown>> | undefined>): ConsentSettings {
	const out: ConsentSettings = { ...DEFAULTS };
	for (const layer of layers) {
		if (!layer) continue;
		for (const key of Object.keys(DEFAULTS) as Array<keyof ConsentSettings>) {
			const value = layer[key];
			if (value === undefined || value === null) continue;
			if (typeof value !== typeof DEFAULTS[key]) continue;
			if (typeof value === "string" && value.trim() === "" && key !== "policyUrl") continue;
			(out as unknown as Record<string, unknown>)[key] = value;
		}
	}
	if (out.position !== "bottom" && out.position !== "bottom-left") out.position = DEFAULTS.position;
	out.revision = Number.isInteger(out.revision) && out.revision > 0 ? out.revision : DEFAULTS.revision;
	return out;
}

export function escapeHtml(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Only site-relative paths and http(s) URLs; anything else (javascript:, data:) is dropped. */
export function safeUrl(value: string): string | undefined {
	const url = value.trim();
	if (/^\/(?!\/)/.test(url)) return url;
	if (/^https?:\/\//i.test(url)) return url;
	return undefined;
}

const CATEGORY_TEXT: Record<(typeof CATEGORIES)[number], { label: string; description: string }> = {
	analytics: { label: "Analytics", description: "Help us understand how visitors use the site." },
	marketing: { label: "Marketing", description: "Used to show relevant adverts and measure campaigns." },
};

export function renderBanner(s: ConsentSettings): string {
	const policy = safeUrl(s.policyUrl);
	const link = policy ? ` <a href="${escapeHtml(policy)}">${escapeHtml(s.policyLabel)}</a>` : "";
	const options = CATEGORIES.map(
		(c) =>
			`<label class="cmsc-opt"><input type="checkbox" name="${c}"> <span><strong>${CATEGORY_TEXT[c].label}</strong> ${CATEGORY_TEXT[c].description}</span></label>`,
	).join("");
	return `<div id="cms-consent" class="cmsc cmsc-${s.position}" role="dialog" aria-labelledby="cms-consent-title" aria-describedby="cms-consent-message" data-revision="${s.revision}"${s.googleConsentMode ? ' data-gcm="1"' : ""} hidden>
<style>${STYLES}</style>
<p id="cms-consent-title" class="cmsc-title">${escapeHtml(s.title)}</p>
<p id="cms-consent-message">${escapeHtml(s.message)}${link}</p>
<form class="cmsc-prefs" hidden><label class="cmsc-opt"><input type="checkbox" checked disabled> <span><strong>Essential</strong> Needed for the site to work. Always on.</span></label>${options}<button type="submit" class="cmsc-btn">Save preferences</button></form>
<div class="cmsc-actions"><button type="button" class="cmsc-btn" data-cmsc="reject">${escapeHtml(s.rejectLabel)}</button><button type="button" class="cmsc-btn" data-cmsc="accept">${escapeHtml(s.acceptLabel)}</button><button type="button" class="cmsc-link" data-cmsc="manage">${escapeHtml(s.manageLabel)}</button></div>
</div>`;
}

// Accept and reject share one style: UK/EU guidance expects rejecting to be as easy as accepting.
// Site tokens are used when the theme defines them.
const STYLES = `#cms-consent{position:fixed;z-index:2147483000;left:1rem;right:1rem;bottom:1rem;max-width:44rem;margin:0 auto;padding:1.25rem;border-radius:.75rem;background:var(--color-surface,#fff);color:var(--color-text,#111);border:1px solid var(--color-border,#ddd);box-shadow:0 10px 30px rgba(0,0,0,.18);font:inherit;font-size:.95rem;line-height:1.5}
#cms-consent[hidden],#cms-consent [hidden]{display:none!important}
#cms-consent.cmsc-bottom-left{right:auto;max-width:26rem;margin:0}
#cms-consent p{margin:0 0 .75rem}
#cms-consent .cmsc-title{font-weight:600;font-size:1.05rem}
#cms-consent a{color:inherit;text-decoration:underline}
#cms-consent .cmsc-actions{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center}
#cms-consent .cmsc-btn{cursor:pointer;padding:.55rem 1rem;border-radius:.5rem;border:1px solid var(--color-brand,#111);background:var(--color-brand,#111);color:var(--color-on-brand,#fff);font:inherit;font-weight:500}
#cms-consent .cmsc-link{cursor:pointer;background:none;border:0;padding:.55rem .25rem;color:inherit;text-decoration:underline;font:inherit}
#cms-consent .cmsc-btn:focus-visible,#cms-consent .cmsc-link:focus-visible{outline:2px solid var(--color-brand-ring,#2563eb);outline-offset:2px}
#cms-consent .cmsc-prefs{display:grid;gap:.6rem;margin:0 0 .9rem}
#cms-consent .cmsc-opt{display:flex;gap:.5rem;align-items:flex-start}
#cms-consent .cmsc-prefs .cmsc-btn{justify-self:start}`;

/** Google Consent Mode v2 defaults; must run before any Google tag, so it goes in <head>. */
export const GCM_DEFAULTS_SCRIPT = `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag("consent","default",{ad_storage:"denied",ad_user_data:"denied",ad_personalization:"denied",analytics_storage:"denied",wait_for_update:500});`;

/** Runs at body end. Self-contained: reads its configuration from the banner's data attributes. */
export const CLIENT_SCRIPT = `(function(){
var root=document.getElementById("cms-consent");if(!root)return;
var CATS=${JSON.stringify(CATEGORIES)},REV=root.getAttribute("data-revision")||"1",GCM=root.hasAttribute("data-gcm");
var form=root.querySelector(".cmsc-prefs");
function read(){var m=document.cookie.match(/(?:^|; )cms_consent=([^;]*)/);if(!m)return null;var v=decodeURIComponent(m[1]),i=v.indexOf(":");if(i<0||v.slice(0,i)!==REV)return null;var on=v.slice(i+1).split(","),o={necessary:true};CATS.forEach(function(c){o[c]=on.indexOf(c)>=0});return o}
function write(o){var on=CATS.filter(function(c){return o[c]});document.cookie="cms_consent="+encodeURIComponent(REV+":"+on.join(","))+"; Path=/; Max-Age=15552000; SameSite=Lax"+(location.protocol==="https:"?"; Secure":"")}
function activate(o){document.querySelectorAll('script[type="text/plain"][data-consent]').forEach(function(old){if(!o[old.getAttribute("data-consent")])return;var s=document.createElement("script");for(var i=0;i<old.attributes.length;i++){var a=old.attributes[i];if(a.name!=="type")s.setAttribute(a.name,a.value)}if(!old.src)s.text=old.text;old.replaceWith(s)})}
function gcm(o){if(!GCM||typeof window.gtag!=="function")return;var a=o.analytics?"granted":"denied",m=o.marketing?"granted":"denied";window.gtag("consent","update",{analytics_storage:a,ad_storage:m,ad_user_data:m,ad_personalization:m})}
function apply(o){gcm(o);activate(o);window.dispatchEvent(new CustomEvent("cms:consent",{detail:o}))}
function choose(o){o.necessary=true;write(o);root.hidden=true;apply(o)}
function open(){var o=read()||{};CATS.forEach(function(c){form.elements[c].checked=!!o[c]});root.hidden=false;var b=root.querySelector("button");if(b)b.focus()}
root.addEventListener("click",function(e){var t=e.target.closest("[data-cmsc]");if(!t)return;var act=t.getAttribute("data-cmsc"),o={};
if(act==="manage"){form.hidden=!form.hidden;return}
CATS.forEach(function(c){o[c]=act==="accept"});choose(o)});
form.addEventListener("submit",function(e){e.preventDefault();var o={};CATS.forEach(function(c){o[c]=form.elements[c].checked});choose(o)});
document.addEventListener("click",function(e){var t=e.target.closest&&e.target.closest("[data-cookie-settings],a[href='#cookie-settings']");if(!t)return;e.preventDefault();form.hidden=false;open()});
window.cmsConsent={get:read,open:open};
var saved=read();if(saved)apply(saved);else root.hidden=false;
})();`;
