import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { ConsoleData, ViewId } from '../../../types';
import { SETTINGS_GROUPS, SETTINGS_SECTIONS, type SettingsSection } from './navigation';

export function SettingsPage({
  data,
  section,
  setView,
  renderSection,
}: {
  data: ConsoleData;
  section: SettingsSection;
  setView: (view: ViewId) => void;
  renderSection: (section: SettingsSection) => ReactNode;
}) {
  const [active, setActive] = useState<SettingsSection>(section);

  useEffect(() => {
    setActive(section);
  }, [section]);

  return (
    <section className="settingsShell">
      <aside className="settingsSidebar" aria-label="Settings sections">
        <div className="settingsSidebarHeader">
          <strong>Settings</strong>
          <button className="iconButton quiet" type="button" title="Back to console" onClick={() => setView('agents')}>
            <X size={17} />
          </button>
        </div>
        {SETTINGS_GROUPS.map((group) => (
          <div className="settingsNavGroup" key={group}>
            <div className="settingsGroupLabel">{group}</div>
            <div className="settingsNav">
              {SETTINGS_SECTIONS.filter((item) => item.group === group).map((item) => {
                const Icon = item.icon;
                const nextView: ViewId = item.id === 'general' ? 'settings' : item.id;
                return (
                  <button
                    type="button"
                    key={item.id}
                    className={`settingsNavItem ${active === item.id ? 'active' : ''}`}
                    onClick={() => {
                      setActive(item.id);
                      setView(nextView);
                    }}
                  >
                    <Icon size={18} />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </aside>
      <div className="settingsContent">
        {renderSection(active)}
      </div>
    </section>
  );
}
