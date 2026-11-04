import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(__dirname, "..", "seed", "seed.json");

function pt(texts) {
	return texts.map((text, i) => ({
		_type: "block",
		style: "normal",
		children: [{ _type: "span", text, _key: `s${i}` }],
		_key: `b${i}`,
	}));
}

const projects = [
	["zerogterminal", "ZeroGTerminal", "AI-first terminal manager with multi-pane support, session persistence, and built-in speech-to-text transcription.", "https://github.com/HappyMonkeyAI/ZeroGTerm", "https://happymonkey.ai/images/projects/zerogterm.png"],
	["transport", "Transport (3JS TTD)", "Browser transport tycoon — roads, rail, signals, and growing towns on a Three.js map.", "https://transport.happymonkey.ai/", "https://happymonkey.ai/images/projects/transport.jpg"],
	["mrpg-realms", "MRPG Realms", "Shared-world multiplayer voxel realms — seed a world and play with friends.", "https://realms.happymonkey.ai/", "https://happymonkey.ai/images/projects/realms.jpg"],
	["riffly", "Riffly", "Hear it. Play it. — interactive music experience (web live; Android in progress).", "https://riffly.happymonkey.ai/", "https://happymonkey.ai/images/projects/riffly.jpg"],
	["vibes-desktop", "vibes desktop", "Public beta desktop app for Vibes missions: voice input, activity ledger, mission control UI.", "https://github.com/HappyMonkeyAI/vibes-desktop", "https://happymonkey.ai/images/projects/vibes-desktop.jpg"],
	["aion", "AION", "Browser-based Space Empire 4X strategy game.", "https://aion.happymonkey.ai/", "https://happymonkey.ai/images/projects/Aion.jpg"],
	["populai", "PopulAI", "Browser-based 3D god game — a modern Populous.", "https://populai.happymonkey.ai/dashboard", "https://happymonkey.ai/images/projects/populai.jpg"],
	["herding-cats", "Herding Cats", "Low-poly Three.js cat-herding game for desktop and mobile.", "https://cats.happymonkey.ai/", "https://happymonkey.ai/images/projects/herdingcats.jpg"],
	["vector-run", "VECTOR RUN", "One fighter vs escalating carrier strikes and fleet battles.", "https://vector.happymonkey.ai/", "https://happymonkey.ai/images/projects/vectorrun.jpg"],
	["astraeus-9", "Astraeus-9", "Procedural asteroid miner with drone pathfinding and base building.", "https://astraeus.happymonkey.ai/", "https://happymonkey.ai/images/projects/astraeus.jpg"],
	["glitch", "Glitch", "A low-fi AI cyber pet for the browser.", "https://glitch.happymonkey.ai/", "https://happymonkey.ai/images/projects/gltich.jpg"],
	["gosafe", "GOSafe", "Location-based disaster risk intelligence for real places and dates.", "https://gosafe.happymonkey.ai/", "https://happymonkey.ai/images/projects/gosafe.jpg"],
];

const tools = [
	["monkeyswarm", "MonkeySwarm", "One-command MCP swarm installer", "fa-robot"],
	["vibes-desktop-tool", "vibes-desktop", "Mission control for Vibes", "fa-desktop"],
	["vibes", "vibes", "Autonomous TUI agent harness", "fa-terminal"],
	["agentsprotocol", "AgentsProtocol", "AI agent dev framework", "fa-network-wired"],
	["mcp-daw", "mcp-daw", "MCP music sequencer", "fa-music"],
	["threegameforge", "ThreeGameForge", "Three.js game framework", "fa-puzzle-piece"],
	["resource-sentinel", "Resource Sentinel", "Agent host admission control", "fa-shield-alt"],
	["astro-cms", "astro-cms", "Agent-native Astro CMS", "fa-server"],
];

const posts = [
	["resource-sentinel-mcp", "Resource Sentinel MCP: stop local AI agents from melting the host", "Telemetry plus lease-based admission control that agents can request before heavy work.", "2026-07-16"],
	["tools-and-soft-launches", "Tools and soft launches: agents, desktops, MCP", "Selected posts on products, agents, and practical delivery.", "2026-08-01"],
	["vibes-tui-v0-1-3", "vibes TUI v0.1.3: smarter AI agent harness", "Triage, steering, stability fixes, and multi-provider support.", "2026-09-12"],
];

const seed = {
	$schema: "https://emdashcms.com/seed.schema.json",
	version: "1",
	meta: {
		name: "HappyMonkey",
		description: "HappyMonkey.AI engineering portfolio on EmDash",
		author: "HappyMonkey AI",
	},
	settings: {
		title: "HappyMonkey.AI",
		tagline: "Software first. AI where it helps.",
		logo: {
			$media: {
				url: "/images/HappyMonkey-dark-logo.png",
				alt: "HappyMonkey.AI Logo",
				filename: "HappyMonkey-dark-logo.png",
			},
		},
	},
	blockTypes: [
		{
			slug: "hero",
			label: "Hero",
			currentVersion: 1,
			versions: [
				{
					version: 1,
					fields: [
						{ slug: "eyebrow", label: "Eyebrow", type: "string" },
						{ slug: "heading", label: "Heading", type: "string", required: true },
						{ slug: "lead", label: "Lead", type: "text" },
						{ slug: "primary_label", label: "Primary CTA label", type: "string" },
						{ slug: "primary_href", label: "Primary CTA href", type: "string" },
						{ slug: "secondary_label", label: "Secondary CTA label", type: "string" },
						{ slug: "secondary_href", label: "Secondary CTA href", type: "string" },
						{ slug: "tertiary_label", label: "Tertiary CTA label", type: "string" },
						{ slug: "tertiary_href", label: "Tertiary CTA href", type: "string" },
						{ slug: "video_url", label: "Background video URL", type: "string" },
						{ slug: "poster_url", label: "Video poster URL", type: "string" },
					],
				},
			],
		},
		{
			slug: "prose_band",
			label: "Prose band",
			currentVersion: 1,
			versions: [
				{
					version: 1,
					fields: [
						{ slug: "eyebrow", label: "Eyebrow", type: "string" },
						{ slug: "heading", label: "Heading", type: "string" },
						{ slug: "body", label: "Body", type: "text" },
						{ slug: "align", label: "Align", type: "string" },
					],
				},
			],
		},
		{
			slug: "project_grid",
			label: "Project grid",
			currentVersion: 1,
			versions: [
				{
					version: 1,
					fields: [
						{ slug: "eyebrow", label: "Eyebrow", type: "string" },
						{ slug: "heading", label: "Heading", type: "string" },
						{ slug: "description", label: "Description", type: "text" },
						{ slug: "limit", label: "Limit", type: "integer" },
					],
				},
			],
		},
		{
			slug: "tool_strip",
			label: "Tool strip",
			currentVersion: 1,
			versions: [
				{
					version: 1,
					fields: [
						{ slug: "eyebrow", label: "Eyebrow", type: "string" },
						{ slug: "heading", label: "Heading", type: "string" },
						{ slug: "description", label: "Description", type: "text" },
						{ slug: "github_url", label: "GitHub URL", type: "url" },
					],
				},
			],
		},
		{
			slug: "insight_list",
			label: "Insight list",
			currentVersion: 1,
			versions: [
				{
					version: 1,
					fields: [
						{ slug: "eyebrow", label: "Eyebrow", type: "string" },
						{ slug: "heading", label: "Heading", type: "string" },
						{ slug: "description", label: "Description", type: "text" },
						{ slug: "limit", label: "Limit", type: "integer" },
					],
				},
			],
		},
		{
			slug: "cta_contact",
			label: "Contact CTA",
			currentVersion: 1,
			versions: [
				{
					version: 1,
					fields: [
						{ slug: "eyebrow", label: "Eyebrow", type: "string" },
						{ slug: "heading", label: "Heading", type: "string" },
						{ slug: "body", label: "Body", type: "text" },
						{ slug: "location", label: "Location", type: "string" },
						{ slug: "email", label: "Email", type: "string" },
						{ slug: "phone", label: "Phone", type: "string" },
						{ slug: "phone_tel", label: "Phone tel", type: "string" },
					],
				},
			],
		},
	],
	collections: [
		{
			slug: "posts",
			label: "Insights",
			labelSingular: "Insight",
			urlPattern: "/posts/{slug}",
			supports: ["drafts", "revisions", "preview", "scheduling", "search", "seo"],
			commentsEnabled: false,
			fields: [
				{ slug: "title", label: "Title", type: "string", required: true, searchable: true },
				{ slug: "featured_image", label: "Featured Image", type: "image" },
				{ slug: "content", label: "Content", type: "portableText", searchable: true },
				{ slug: "excerpt", label: "Excerpt", type: "text" },
			],
		},
		{
			slug: "pages",
			label: "Pages",
			labelSingular: "Page",
			urlPattern: "/pages/{slug}",
			supports: ["drafts", "revisions", "preview", "search", "seo"],
			fields: [
				{ slug: "title", label: "Title", type: "string", required: true, searchable: true },
				{ slug: "content", label: "Content", type: "portableText", searchable: true },
				{
					slug: "layout",
					label: "Layout",
					type: "blocks",
					validation: {
						allowedTypes: [
							"hero",
							"prose_band",
							"project_grid",
							"tool_strip",
							"insight_list",
							"cta_contact",
						],
						maxItems: 20,
					},
				},
			],
		},
		{
			slug: "projects",
			label: "Projects",
			labelSingular: "Project",
			urlPattern: "/projects/{slug}",
			supports: ["drafts", "revisions", "preview", "search", "seo"],
			fields: [
				{ slug: "title", label: "Title", type: "string", required: true, searchable: true },
				{ slug: "summary", label: "Summary", type: "text", searchable: true },
				{ slug: "featured_image", label: "Featured Image", type: "image" },
				{ slug: "external_url", label: "External URL", type: "url" },
				{ slug: "body", label: "Body", type: "portableText", searchable: true },
			],
		},
		{
			slug: "tools",
			label: "Tools",
			labelSingular: "Tool",
			urlPattern: "/tools/{slug}",
			supports: ["drafts", "search"],
			fields: [
				{ slug: "title", label: "Title", type: "string", required: true, searchable: true },
				{ slug: "tagline", label: "Tagline", type: "string", searchable: true },
				{ slug: "icon", label: "Icon (Font Awesome class, e.g. fa-robot)", type: "string" },
				{ slug: "url", label: "URL", type: "url" },
			],
		},
	],
	taxonomies: [
		{
			name: "tag",
			label: "Tags",
			labelSingular: "Tag",
			hierarchical: false,
			collections: ["posts"],
			terms: [
				{ slug: "agents", label: "Agents" },
				{ slug: "tools", label: "Tools" },
				{ slug: "infrastructure", label: "Infrastructure" },
			],
		},
	],
	bylines: [{ id: "byline-stephen", slug: "stephen", displayName: "Stephen Phillips" }],
	menus: [
		{
			name: "primary",
			label: "Primary Navigation",
			items: [
				{ type: "custom", label: "Home", url: "/" },
				{ type: "custom", label: "Projects", url: "/projects" },
				{ type: "custom", label: "Insights", url: "/posts" },
				{ type: "custom", label: "Contact", url: "/#contact" },
			],
		},
	],
	widgetAreas: [
		{
			name: "footer",
			label: "Footer",
			description: "Footer widgets",
			widgets: [
				{
					type: "component",
					componentId: "core:recent-posts",
					title: "Recent insights",
					props: { count: 3, showDate: true },
				},
			],
		},
	],
	content: {
		pages: [
			{
				id: "home",
				slug: "home",
				status: "published",
				data: {
					title: "Happy Monkey AI - developer building useful things",
					content: [],
					layout: [
						{
							_type: "hero",
							_version: 1,
							_key: "home-hero",
							eyebrow: "HappyMonkey.AI",
							heading: "Happy Monkey AI - developer building useful things",
							lead: "Full-stack software engineer working across AI agents, MCP systems, developer tools, and products—from first experiment to working software.",
							primary_label: "Explore projects",
							primary_href: "#recent-work",
							secondary_label: "Read the blog",
							secondary_href: "#latest-insights",
							tertiary_label: "Get in touch",
							tertiary_href: "#contact",
							video_url: "/videos/header-video.mp4",
							poster_url: "/images/HappyMonkey-dark-logo.png",
						},
						{
							_type: "prose_band",
							_version: 1,
							_key: "home-strip",
							body: "Building with code, models, tools, and a healthy respect for what still needs testing.\n\nOpenAI · Anthropic · n8n · LangChain · Relevance AI · Voiceflow",
							align: "center",
						},
						{
							_type: "project_grid",
							_version: 1,
							_key: "home-projects",
							eyebrow: "Selected work",
							heading: "Projects",
							description:
								"A selection of software experiments and products across AI, developer tools, data, and interactive experiences.",
							limit: 12,
						},
						{
							_type: "tool_strip",
							_version: 1,
							_key: "home-tools",
							eyebrow: "Open source",
							heading: "Tools & experiments",
							description:
								"Open-source work exploring agent orchestration, local AI, developer workflows, and practical infrastructure.",
							github_url: "https://github.com/HappyMonkeyAI",
						},
						{
							_type: "prose_band",
							_version: 1,
							_key: "home-about",
							eyebrow: "About Stephen",
							heading: "Software first. AI where it helps.",
							body: "I'm a full-stack software engineer and AI systems developer. My work brings established software engineering together with local and hosted language models, tool integrations, and multi-agent workflows.\n\nI enjoy turning emerging ideas into usable systems: developer infrastructure, MCP servers, voice interfaces, data tools, and product experiments. This site is where I share selected projects and the engineering decisions behind them.",
							align: "start",
						},
						{
							_type: "insight_list",
							_version: 1,
							_key: "home-insights",
							eyebrow: "Writing",
							heading: "Latest from the build log",
							description:
								"Selected posts on products, agents, and practical delivery — not daily roundups.",
							limit: 3,
						},
						{
							_type: "cta_contact",
							_version: 1,
							_key: "home-contact",
							eyebrow: "Contact",
							heading: "Start a conversation",
							body: "Email for demos, collaborations, or questions about the tools and games on this site.",
							location: "HappyMonkey.AI — London, UK.",
							email: "info@happymonkey.ai",
							phone: "+44 7345 637409",
							phone_tel: "+447345637409",
						},
					],
				},
			},
			{
				id: "privacy-policy",
				slug: "privacy-policy",
				status: "published",
				data: {
					title: "Privacy Policy",
					content: pt([
						"HappyMonkey.AI operates this website. This policy explains what limited information we collect and how we use it.",
						"We collect contact details you send us, standard server logs, and optional analytics cookies only with consent.",
						"We do not sell personal data. Contact info@happymonkey.ai for access or deletion requests (UK/EEA).",
					]),
				},
			},
			{
				id: "cookie-policy",
				slug: "cookie-policy",
				status: "published",
				data: {
					title: "Cookie Policy",
					content: pt([
						"Essential cookies keep the site working. Analytics cookies load only after consent on production cutover.",
						"You can change your preference via the cookie banner when it is enabled.",
					]),
				},
			},
			{
				id: "terms-conditions",
				slug: "terms-conditions",
				status: "published",
				data: {
					title: "Terms and Conditions",
					content: pt([
						"Content on this site is provided for information. Projects and tools may be experimental.",
						"Contact info@happymonkey.ai with questions about commercial use or collaborations.",
					]),
				},
			},
		],
		projects: projects.map(([id, title, summary, url, img]) => ({
			id,
			slug: id,
			status: "published",
			data: {
				title,
				summary,
				external_url: url,
				featured_image: {
					$media: { url: img, alt: `${title} screenshot`, filename: `${id}.jpg` },
				},
				body: pt([summary]),
			},
		})),
		tools: tools.map(([id, title, tagline, icon]) => ({
			id,
			slug: id,
			status: "published",
			data: { title, tagline, icon, url: "https://github.com/HappyMonkeyAI" },
		})),
		posts: posts.map(([id, title, excerpt, date]) => ({
			id,
			slug: id,
			status: "published",
			published_at: `${date}T12:00:00.000Z`,
			data: {
				title,
				excerpt,
				content: pt([
					excerpt,
					"Full article body can be expanded in admin after staging claim.",
				]),
			},
			bylines: [{ byline: "byline-stephen" }],
			taxonomies: { tag: ["agents", "tools"] },
		})),
	},
};

fs.writeFileSync(out, `${JSON.stringify(seed, null, "\t")}\n`);
console.log(`Wrote ${out} (${fs.statSync(out).size} bytes)`);
