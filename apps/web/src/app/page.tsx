import { PillarCard } from '@/components/PillarCard';

const pillars = [
  {
    title: 'Hospitals',
    description: 'Run admissions, scheduling, and clinical records on a modern, lightweight EMR.',
  },
  {
    title: 'Patients',
    description: 'Own your health data and carry it with you across every provider.',
  },
  {
    title: 'Developers',
    description: 'Build on an open, extensible platform licensed under AGPL-3.0.',
  },
];

export default function HomePage() {
  return (
    <>
      <main className="landing">
        <section className="hero">
          <h1>openrunic</h1>
          <p className="tagline">Open-source operating system for human health</p>
        </section>
        <section className="pillars" aria-label="Who openrunic serves">
          {pillars.map((pillar) => (
            <PillarCard key={pillar.title} title={pillar.title} description={pillar.description} />
          ))}
        </section>
      </main>
      <footer className="site-footer">
        <p>openrunic is open-source software, not a certified medical device.</p>
      </footer>
    </>
  );
}
