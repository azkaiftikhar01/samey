Fix the following UI issues reported by samey. Make focused changes, keep unrelated code as is, and re-run samey afterwards to verify.

1. [placeholder-content] Placeholder content shipped
Found 5 pieces of placeholder content. Visitors notice this immediately and it signals the site is unfinished. Source locations: 9 matching lines in the repository.
Evidence:
- route / (desktop), index.html:34, selector `section:nth-of-type(3) > div > div:nth-of-type(1) > p`, "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed…", lorem ipsum
- route / (desktop), index.html:34, selector `section:nth-of-type(3) > div > div:nth-of-type(2) > p`, "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed…", lorem ipsum
- route / (desktop), index.html:34, selector `section:nth-of-type(3) > div > div:nth-of-type(3) > p`, "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed…", lorem ipsum
- route / (desktop), index.html:43, selector `section:nth-of-type(4) > div > div:nth-of-type(2) > p`, "Michael Chen, CTO at Acme Corp", placeholder company
- route / (desktop), index.html:20, selector `section:nth-of-type(1) > div > img:nth-of-type(3)`, "https://via.placeholder.com/120x40", placeholder image service
- about.html:28, "<div class="card"><h3>Fast</h3><p>Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod.</p></div>", lorem ipsum
- about.html:37, "<footer>&copy; 2026 Your Company. <a href="#">Privacy</a><a href="#">Terms</a></footer>", placeholder company
- features.html:28, "<div class="card"><h3>Fast</h3><p>Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod.</p></div>", lorem ipsum
- features.html:37, "<footer>&copy; 2026 Your Company. <a href="#">Privacy</a><a href="#">Terms</a></footer>", placeholder company
- index.html:35, "<div class="card"><h3>2. Automate</h3><p>Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor.</p></div>", lorem ipsum
Fix: Replace every placeholder with real content, or remove the section until the content exists.

2. [placeholder-links] Links that go nowhere
14 links point to "#" or nowhere. These look clickable and do nothing, which is common in generated navigation and footers.
Evidence:
- route / (desktop), selector `nav > div > a:nth-of-type(4)`, "Blog", href="#"
- route / (desktop), also on /about, /features, selector `header > a:nth-of-type(1)`, "Get Started", href="#"
- route / (desktop), also on /about, /features, selector `header > a:nth-of-type(2)`, "Learn More", href="#"
- route / (desktop), also on /about, /features, selector `footer > a:nth-of-type(1)`, "Privacy", href="#"
- route / (desktop), also on /about, /features, selector `footer > a:nth-of-type(2)`, "Terms", href="#"
- route / (desktop), selector `footer > a:nth-of-type(3)`, "Twitter", href="#"
Fix: Point each link at a real page, turn it into a button if it triggers an action, or remove it.

3. [horizontal-overflow] Horizontal scrolling on mobile
3 pages scroll sideways on mobile. Elements are wider than the screen.
Evidence:
- route / (mobile), selector `section:nth-of-type(1) > div > img:nth-of-type(4)`, extends to 411px in a 390px viewport
- route / (mobile), selector `section:nth-of-type(2) > div > div:nth-of-type(3)`, extends to 502px in a 390px viewport
- route / (mobile), selector `section:nth-of-type(3) > div > div:nth-of-type(3)`, extends to 508px in a 390px viewport
- route /about (mobile), also on /features, selector `section:nth-of-type(1) > div > div:nth-of-type(3)`, extends to 498px in a 390px viewport
- route /about (mobile), also on /features, selector `section:nth-of-type(2) > div > div:nth-of-type(3)`, extends to 505px in a 390px viewport
Fix: Find the listed elements and constrain them: max-width: 100%, flex-wrap, min-width: 0 on flex children, or overflow-x: auto on wide tables and code blocks.

4. [failed-requests] Failed asset requests
5 requests failed while loading pages, 1 of them scripts, styles, or documents.
Evidence:
- route /, "http://127.0.0.1:49945/missing-theme.css", stylesheet: HTTP 404
- route /, "http://127.0.0.1:49945/logo-a.png", image: HTTP 404
- route /, "http://127.0.0.1:49945/logo-b.png", image: HTTP 404
- route /, "http://127.0.0.1:49945/logo-d.png", image: HTTP 404
- route /, "http://127.0.0.1:49945/missing-hero.png", image: HTTP 404
Fix: Fix the asset paths or remove references to files that do not exist.

5. [console-errors] JavaScript errors in the console
3 console errors on 2 pages, including 1 uncaught exception.
Evidence:
- route /, also on /careers, "Failed to load resource: the server responded with a status of 404 (Not Found)"
- route /, "Uncaught: Cannot read properties of null (reading 'classList')"
Fix: Open the browser console on each listed page and fix the errors; uncaught exceptions often mean a feature silently does not work.

6. [empty-controls] Buttons and links without an accessible name
1 interactive element have no accessible name. Screen readers announce them as just "button" or "link". Icon-only buttons are the usual cause.
Evidence:
- route / (desktop), selector `nav > div > button`, "<button>"
Fix: Add an aria-label to icon-only buttons and links, or include visually hidden text.

7. [broken-internal-links] Broken internal links
1 internal link lead to pages that do not load.
Evidence:
- route /, "http://127.0.0.1:49945/careers", HTTP 404
Fix: Fix the target route or update the link. Remove navigation entries for pages that do not exist yet.

8. [duplicate-copy] Repeated paragraphs
7 paragraphs appear more than once across the site. Repeated copy suggests sections were duplicated rather than written.
Evidence:
- route / (desktop), index.html:26, selector `section:nth-of-type(2) > div > div:nth-of-type(1) > p`, "Blazing fast performance that scales effortlessly with your business needs."
- route /about (desktop), about.html:20, selector `section:nth-of-type(1) > div > div:nth-of-type(1) > p`, "Blazing fast performance that scales effortlessly with your business needs."
- route / (desktop), index.html:27, selector `section:nth-of-type(2) > div > div:nth-of-type(2) > p`, "Enterprise-grade security that keeps your data safe and sound at all times."
- route /about (desktop), about.html:21, selector `section:nth-of-type(1) > div > div:nth-of-type(2) > p`, "Enterprise-grade security that keeps your data safe and sound at all times."
- route / (desktop), index.html:34, selector `section:nth-of-type(3) > div > div:nth-of-type(1) > p`, "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod."
- route /about (desktop), about.html:28, selector `section:nth-of-type(2) > div > div:nth-of-type(1) > p`, "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod."
- route /about (desktop), about.html:14, selector `header > p`, "Empower your team with innovative solutions that harness the power of AI."
- route /features (desktop), features.html:14, selector `header > p`, "Empower your team with innovative solutions that harness the power of AI."
- route /about (desktop), about.html:22, selector `section:nth-of-type(1) > div > div:nth-of-type(3) > p`, "We help over 50,000+ customers in 120 countries achieve more every day."
- route /features (desktop), features.html:22, selector `section:nth-of-type(1) > div > div:nth-of-type(3) > p`, "We help over 50,000+ customers in 120 countries achieve more every day."
Fix: Write copy specific to each place it appears, or remove the duplicate.

9. [small-touch-targets] Touch targets too small
11 controls are smaller than 24x24px on mobile (WCAG 2.5.8 minimum).
Evidence:
- route / (mobile), selector `nav > div > a:nth-of-type(1)`, "Features", 56x17px
- route / (mobile), selector `nav > div > a:nth-of-type(2)`, "About", 39x17px
- route / (mobile), selector `nav > div > a:nth-of-type(3)`, "Careers", 50x17px
- route / (mobile), selector `nav > div > a:nth-of-type(4)`, "Blog", 29x17px
- route / (mobile), selector `nav > div > button`, 18x18px
- route /about (mobile), also on /features, selector `nav > div > a:nth-of-type(1)`, "Home", 38x17px
- route /about (mobile), also on /features, selector `nav > div > a:nth-of-type(2)`, "Features", 56x17px
- route /about (mobile), also on /features, selector `nav > div > a:nth-of-type(3)`, "About", 39x17px
Fix: Increase padding on small controls so the tappable area is at least 24px, ideally 44px.

10. [broken-images] Broken images
4 images failed to load.
Evidence:
- route / (desktop), selector `section:nth-of-type(1) > div > img:nth-of-type(1)`, "http://127.0.0.1:49945/logo-a.png"
- route / (desktop), selector `section:nth-of-type(1) > div > img:nth-of-type(2)`, "http://127.0.0.1:49945/logo-b.png"
- route / (desktop), selector `section:nth-of-type(1) > div > img:nth-of-type(4)`, "http://127.0.0.1:49945/logo-d.png"
- route / (desktop), selector `img`, "http://127.0.0.1:49945/missing-hero.png"
Fix: Fix the image paths or remove the images.

11. [missing-alt] Images without alt text
1 image have no alt attribute.
Evidence:
- route / (desktop), selector `section:nth-of-type(1) > div > img:nth-of-type(2)`, "http://127.0.0.1:49945/logo-b.png"
Fix: Describe informative images in alt text; use alt="" for purely decorative ones.

12. [glow-effects] Decorative glows, blur blobs, and glass panels (design observation, use judgment)
Found 33 colored glow shadows, 3 blurred background blobs, 24 glass panels. Layered glows and glass are decoration the content does not ask for, and they flatten hierarchy because everything shines equally.
Evidence:
- route / (desktop), also on /about, /features, selector `header > div`, "filter: blur(80px); background: rgb(168, 85, 247)", blurred decorative blob
- route / (desktop), also on /about, /features, selector `header > a:nth-of-type(1)`, "rgba(168, 85, 247, 0.6) 0px 0px 40px 0px", colored glow shadow
- route / (desktop), also on /about, /features, selector `header > a:nth-of-type(2)`, "rgba(168, 85, 247, 0.6) 0px 0px 40px 0px", colored glow shadow
- route / (desktop), also on /about, /features, selector `section:nth-of-type(2) > div > div:nth-of-type(1)`, "rgba(99, 102, 241, 0.35) 0px 0px 30px 0px", colored glow shadow
- route / (desktop), also on /about, /features, selector `section:nth-of-type(2) > div > div:nth-of-type(1)`, "backdrop-filter: blur(10px)", glass panel
- route / (desktop), also on /about, /features, selector `section:nth-of-type(2) > div > div:nth-of-type(2)`, "rgba(99, 102, 241, 0.35) 0px 0px 30px 0px", colored glow shadow
- route / (desktop), also on /about, /features, selector `section:nth-of-type(2) > div > div:nth-of-type(2)`, "backdrop-filter: blur(10px)", glass panel
- route / (desktop), also on /about, /features, selector `section:nth-of-type(2) > div > div:nth-of-type(3)`, "rgba(99, 102, 241, 0.35) 0px 0px 30px 0px", colored glow shadow
- route / (desktop), also on /about, /features, selector `section:nth-of-type(2) > div > div:nth-of-type(3)`, "backdrop-filter: blur(10px)", glass panel
- route / (desktop), selector `section:nth-of-type(3) > div > div:nth-of-type(1)`, "rgba(99, 102, 241, 0.35) 0px 0px 30px 0px", colored glow shadow
Fix: Remove decorative blobs and glow shadows. Use elevation sparingly and with neutral shadows; keep at most one deliberate accent effect per page.

13. [emoji-icons] Emoji used as icons (design observation, use judgment)
9 heading, button, or labels use emoji as decoration or icons. Emoji render differently on every platform, cannot be styled to the brand, and are a strong signal of generated UI. Source locations: 9 matching lines in the repository.
Evidence:
- route / (desktop), index.html:26, selector `section:nth-of-type(2) > div > div:nth-of-type(1) > h3`, "🚀 Lightning Fast", emoji 🚀
- route / (desktop), index.html:27, selector `section:nth-of-type(2) > div > div:nth-of-type(2) > h3`, "🔒 Secure by Default", emoji 🔒
- route / (desktop), index.html:28, selector `section:nth-of-type(2) > div > div:nth-of-type(3) > h3`, "✨ AI-Powered", emoji ✨
- route /about (desktop), about.html:20, selector `section:nth-of-type(1) > div > div:nth-of-type(1) > h3`, "💡 Innovation", emoji 💡
- route /about (desktop), also on /features, selector `section:nth-of-type(1) > div > div:nth-of-type(2) > h3`, "🤝 Trust", emoji 🤝
- route /about (desktop), also on /features, selector `section:nth-of-type(1) > div > div:nth-of-type(3) > h3`, "🌍 Impact", emoji 🌍
- route /features (desktop), features.html:20, selector `section:nth-of-type(1) > div > div:nth-of-type(1) > h3`, "💡 Innovation", emoji 💡
- about.html:21, "<div class="card"><h3>🤝 Trust</h3><p>Enterprise-grade security that keeps your data safe and sound at all times.</p></div>", emoji 🤝
- about.html:22, "<div class="card"><h3>🌍 Impact</h3><p>We help over 50,000+ customers in 120 countries achieve more every day.</p></div>", emoji 🌍
- features.html:21, "<div class="card"><h3>🤝 Trust</h3><p>Enterprise-grade security that keeps your data safe and sound at all times.</p></div>", emoji 🤝
Fix: Replace emoji with a consistent SVG icon set (one stroke width, one size scale) or drop the icon entirely where the label is clear.

14. [stock-gradient] Stock blue-violet-pink gradients (design observation, use judgment)
Found the blue-violet-pink gradient on 6 elements, 3 as gradient text, 3 covering a large area. It is the most recognizable default of AI-generated UIs and makes the site read as a template. Source locations: 2 matching lines in the repository.
Evidence:
- route / (desktop), also on /about, /features, selector `header`, "linear-gradient(135deg, rgb(99, 102, 241) 0%, rgb(168, 85, 247) 50%, rgb(236, 72, 153) 100%)", large background
- route / (desktop), also on /about, /features, selector `header > h1`, "linear-gradient(90deg, rgb(192, 132, 252), rgb(244, 114, 182))", gradient text
- styles.css:5, ".hero { position: relative; text-align: center; padding: 120px 24px 100px; background: linear-gradient(135deg, #6366f1 0%, #a855f7 50%, #ec4899 100%); overflow…", css gradient
- styles.css:6, ".hero h1 { font-size: 64px; margin: 0 auto 20px; max-width: 900px; background: linear-gradient(90deg, #c084fc, #f472b6); -webkit-background-clip: text; backgro…", css gradient
Fix: Pick a palette from the brand rather than the framework default: one primary hue used with intent, gradients only where they carry meaning. Replace gradient headline text with solid color and weight contrast.

15. [stock-copy] Interchangeable marketing copy (design observation, use judgment)
14 text blocks lean on stock phrases ("seamless", "lightning/blazing fast", "transform your", "world-class", "revolutionize", "unlock the power/potential"), 5 of them in headings. Copy like this could be pasted onto any product and says nothing about this one. Source locations: 18 matching lines in the repository.
Evidence:
- route / (desktop), index.html:15, selector `header > p`, "Supercharge your productivity with our next-generation, all-…", "supercharge", "next-generation", "all-in-one", "built for the future", "the future of"
- route / (desktop), index.html:28, selector `section:nth-of-type(2) > div > div:nth-of-type(3) > p`, "Leverage cutting-edge AI to transform your workflow like never before…", "cutting-edge", "transform your", "leverage", "like never before"
- route /about (desktop), about.html:14, selector `header > p`, "Empower your team with innovative solutions that harness the…", "empower", "harness the power", "innovative solutions"
- route / (desktop), index.html:14, selector `header > h1`, "Unlock the Power of Seamless AI Workflows", "unlock the power/potential", "seamless"
- route / (desktop), index.html:26, selector `section:nth-of-type(2) > div > div:nth-of-type(1) > p`, "Blazing fast performance that scales effortlessly with your business needs.", "effortless", "lightning/blazing fast"
- route /about (desktop), about.html:29, selector `section:nth-of-type(2) > div > div:nth-of-type(2) > p`, "Everything at your fingertips, made simple for modern teams everywhere.", "at your fingertips", "made simple"
- route / (desktop), index.html:24, selector `section:nth-of-type(2) > p`, "Everything you need to streamline your workflow and elevate your team.", "elevate your", "streamline"
- route / (desktop), index.html:44, selector `section:nth-of-type(4) > div > div:nth-of-type(3) > blockquote`, ""Seamless integration and world-class support. 5-star experie…", "seamless", "world-class"
- route / (desktop), index.html:26, selector `section:nth-of-type(2) > div > div:nth-of-type(1) > h3`, "🚀 Lightning Fast", "lightning/blazing fast"
- route / (desktop), index.html:62, selector `section:nth-of-type(7) > h2`, "Ready to transform your workflow?", "transform your"
Fix: Rewrite headings to state what the product does, for whom, and the concrete result. Replace adjectives with specifics: numbers you can back up, named features, a real example.

16. [card-grid-sameness] The same card grid, over and over (design observation, use judgment)
6 sections use an identical card layout (same structure and column count). Repeating one composition makes every section feel like the previous one.
Evidence:
- route / (desktop), selector `section:nth-of-type(2)`, "Why choose NovaFlow?", 3 cards in 3 columns
- route / (desktop), selector `section:nth-of-type(3)`, "How it works", 3 cards in 3 columns
- route /about (desktop), also on /features, selector `section:nth-of-type(1)`, "Our values", 3 cards in 3 columns
- route /about (desktop), also on /features, selector `section:nth-of-type(2)`, "Why teams love us", 3 cards in 3 columns
Fix: Vary the form to fit the content: a comparison table for plans, a single large example for the main feature, a list for secondary points. Keep cards for content that is genuinely a set of peers.

17. [unresponsive-buttons] Buttons that do nothing (design observation, use judgment)
3 buttons produced no visible change when clicked (no navigation, no DOM update). Hover-only or CSS-only effects can cause false positives, so confirm by hand.
Evidence:
- route / (desktop), selector `section:nth-of-type(7) > button`, "Start your journey"
- route /about (desktop), also on /features, selector `section:nth-of-type(3) > button`, "Start your journey"
Fix: Wire the button to its action, or remove it. If it is a placeholder for a future feature, hide it until the feature exists.

18. [unverified-claims] Unsupported credibility claims (design observation, use judgment)
5 claims such as user counts, ratings, or percentages appear without a visible source. If these are real, they are fine; generated sites often invent them.
Evidence:
- route / (desktop), index.html:19, selector `section:nth-of-type(1) > h2`, "Trusted by 10,000+ teams worldwide", N+ users/customers
- route / (desktop), index.html:42, selector `section:nth-of-type(4) > div > div:nth-of-type(1) > blockquote`, ""NovaFlow changed everything for our team. We ship 10x faster now."", N x faster
- route / (desktop), index.html:44, selector `section:nth-of-type(4) > div > div:nth-of-type(3) > blockquote`, ""Seamless integration and world-class support. 5-star experience."", star rating
- route /about (desktop), about.html:22, selector `section:nth-of-type(1) > div > div:nth-of-type(3) > p`, "We help over 50,000+ customers in 120 countries achieve more every day.", N+ users/customers
- route /about (desktop), about.html:30, selector `section:nth-of-type(2) > div > div:nth-of-type(3) > p`, "99.9% uptime guaranteed with our world-class infrastructure…", percentage claim
Fix: Keep only numbers you can substantiate, and link or footnote the source. Remove invented social proof before launch.

19. [tiny-text] Text too small to read on mobile
10 text elements are smaller than 12px on mobile.
Evidence:
- route / (mobile), selector `footer`, "© 2026 Your Company. Contact john.doe@example.com", 11px
- route / (mobile), also on /about, /features, selector `footer > a:nth-of-type(1)`, "Privacy", 11px
- route / (mobile), also on /about, /features, selector `footer > a:nth-of-type(2)`, "Terms", 11px
- route / (mobile), selector `footer > a:nth-of-type(3)`, "Twitter", 11px
- route /about (mobile), also on /features, selector `footer`, "© 2026 Your Company.", 11px
Fix: Keep body text at 16px and secondary text at 13 to 14px or larger on small screens.

20. [generic-link-text] Vague link and button labels
3 links use labels like "Learn more" that do not say where they go. Screen reader users navigating by links hear a list of identical labels.
Evidence:
- route / (desktop), also on /about, /features, selector `header > a:nth-of-type(2)`, "Learn More"
Fix: Name the destination: "Read the pricing FAQ", "See how imports work".

21. [missing-metadata] Missing page metadata
7 metadata gaps across 3 pages.
Evidence:
- route /, also on /about, /features, no meta description
- route /, also on /about, /features, no lang attribute on <html>
- route /, 3 pages share the title "NovaFlow"
Fix: Give each page a unique title and description, and set <html lang>.

22. [centered-everything] Everything is centered (design observation, use judgment)
16 of 16 section headings are centered. Symmetric, centered stacks everywhere remove the reading line and make hierarchy depend only on size.
Evidence:
- route / (desktop), selector `header`, "Unlock the Power of Seamless AI Workflows"
- route / (desktop), selector `section:nth-of-type(1)`, "Trusted by 10,000+ teams worldwide"
- route / (desktop), selector `section:nth-of-type(2)`, "Why choose NovaFlow?"
- route / (desktop), selector `section:nth-of-type(3)`, "How it works"
- route / (desktop), selector `section:nth-of-type(4)`, "What our customers say"
- route / (desktop), selector `section:nth-of-type(5)`, "Simple, transparent pricing"
- route / (desktop), selector `section:nth-of-type(6)`, "Frequently Asked Questions"
- route / (desktop), selector `section:nth-of-type(7)`, "Ready to transform your workflow?"
Fix: Left-align long-form and feature content; reserve centering for one or two moments such as the hero or a closing call to action.

23. [stock-landing-sequence] Stock SaaS landing page sequence (design observation, use judgment)
The home page follows the stock sequence: hero → logos → features → testimonials → pricing → faq → cta. Using familiar sections is fine on its own; combined with stock visuals it makes the page interchangeable with thousands of others.
Evidence:
- route / (desktop), selector `header`, "hero: Unlock the Power of Seamless AI Workflows"
- route / (desktop), selector `section:nth-of-type(1)`, "logos: Trusted by 10,000+ teams worldwide"
- route / (desktop), selector `section:nth-of-type(2)`, "features: Why choose NovaFlow?"
- route / (desktop), selector `section:nth-of-type(4)`, "testimonials: What our customers say"
- route / (desktop), selector `section:nth-of-type(5)`, "pricing: Simple, transparent pricing"
- route / (desktop), selector `section:nth-of-type(6)`, "faq: Frequently Asked Questions"
- route / (desktop), selector `section:nth-of-type(7)`, "cta: Ready to transform your workflow?"
Fix: Lead with what is specific: a real product screenshot or demo, a concrete use case, or an opinion. Cut sections that exist only because the template has them.

24. [duplicated-markup] Copy-pasted component markup (design observation, use judgment)
2 blocks of markup (5+ lines) are repeated with the same structure across files. Copy-pasted sections drift apart over time and make the design inconsistent.
Evidence:
- about.html:19, "<div class="grid">", block repeated 4 times
- features.html:19, "<div class="grid">", block repeated 4 times
- index.html:25, "<div class="grid">", block repeated 4 times
- about.html:20, "<div class="card"><h3></h3><p></p></div>", block repeated 3 times
- features.html:20, "<div class="card"><h3></h3><p></p></div>", block repeated 3 times
- index.html:26, "<div class="card"><h3></h3><p></p></div>", block repeated 3 times
Fix: Extract the repeated block into a component and render it from data.

25. [cross-page-template] Different pages, same template (design observation, use judgment)
Across 3 distinct page types, 67% of section structure is shared on average. Pages with different purposes are built from the same blocks in a similar order.
Evidence:
- route /about, /about vs /features: 100% shared structure
- route /, / vs /about: 50% shared structure
- route /, / vs /features: 50% shared structure
Fix: Design each page around its own task: an about page tells a story, a pricing page compares, a docs page navigates. Reuse components, not whole page skeletons.

26. [anonymous-testimonials] Testimonials without verifiable attribution (design observation, use judgment)
1 testimonial section attribute quotes to a name and job title with no photo, company link, or source. Readers increasingly assume these are invented.
Evidence:
- route / (desktop), selector `section:nth-of-type(4)`, "Sarah Johnson, CEO", quote with name and title only
Fix: Use real testimonials with permission, a photo or company logo, and a link where possible. If you have none yet, remove the section.
