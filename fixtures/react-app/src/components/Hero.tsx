export function Hero() {
  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 py-32 text-center">
      <div className="absolute -top-40 -left-40 h-96 w-96 rounded-full bg-purple-400 blur-3xl opacity-50" />
      <h1 className="bg-gradient-to-r from-violet-200 to-pink-200 bg-clip-text text-transparent text-6xl font-bold">
        Unlock the Power of Seamless Collaboration
      </h1>
      <p className="mt-6 text-xl text-white/80">Supercharge your workflow with our next-generation platform.</p>
      <div className="mt-10 rounded-2xl border border-white/10 bg-white/5 p-[18px] backdrop-blur-xl shadow-purple-500/50">
        <a href="#" className="rounded-full bg-white px-8 py-4 text-[#4c1d95]">Get Started</a>
      </div>
    </section>
  );
}
