export function Features() {
  return (
    <section className="py-24">
      <div className="grid grid-cols-3 gap-8">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-8 shadow-xl">
          <div className="mb-4 text-3xl">🚀</div>
          <h3 className="text-xl font-semibold text-white">Lightning Fast</h3>
          <p className="mt-2 text-gray-400">Lorem ipsum dolor sit amet, consectetur adipiscing elit.</p>
          <a href="#" className="mt-4 inline-block text-purple-400">Learn more</a>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 p-8 shadow-xl">
          <div className="mb-4 text-3xl">🔒</div>
          <h3 className="text-xl font-semibold text-white">Secure by Default</h3>
          <p className="mt-2 text-gray-400">Lorem ipsum dolor sit amet, consectetur adipiscing elit.</p>
          <a href="#" className="mt-4 inline-block text-purple-400">Learn more</a>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 p-8 shadow-xl">
          <div className="mb-4 text-3xl">✨</div>
          <h3 className="text-xl font-semibold text-white">AI-Powered</h3>
          <p className="mt-2 text-gray-400">Lorem ipsum dolor sit amet, consectetur adipiscing elit.</p>
          <a href="#" className="mt-4 inline-block text-purple-400">Learn more</a>
        </div>
      </div>
      <p className="text-center text-sm text-gray-500">Trusted by teams at Acme Corp. Contact jane.doe@example.com</p>
    </section>
  );
}
