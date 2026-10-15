---
"@podosoft/podokit-module-blog": patch
---

Keep the public blog up during API outages. `loadBlogPosts` and `loadBlogComments` return an empty page marked `unavailable` when the API cannot answer, a missing post answers 404 instead of 500, a post page answers a retryable 503 during an outage, and `/blog/mine` checks backend availability before redirecting to sign in, like `/blog/write` and the edit page. The seeded list and post pages show the new `blog.unavailable` and `blog.commentsUnavailable` messages.
