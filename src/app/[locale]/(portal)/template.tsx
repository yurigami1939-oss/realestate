/**
 * Each page arrives with a short fade and rise (CLAUDE.md §14 item 12); a template, unlike a
 * layout, is mounted again on every navigation. No motion when the system asks for less.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <div className="animate-in duration-300 ease-apple fade-in-0 slide-in-from-bottom-1">
      {children}
    </div>
  );
}
