import { type ReactNode, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { OfflineModal } from '../components/OfflineModal';
import { ResourceBar } from '../components/ResourceBar';
import { StoryModal } from '../components/StoryModal';
import { TabBar, type TabDef } from '../components/TabBar';
import { colors, spacing, typography } from '../components/theme';
import { useGameLoop } from '../hooks/useGameLoop';
import { useGameStore } from '../store/gameStore';
import {
  selectActiveStory,
  selectPrestige,
  selectResourceRows,
  selectUpgradeRows,
} from '../store/selectors';
import { IdleScreen } from './IdleScreen';
import { PrestigeScreen } from './PrestigeScreen';
import { StoryLogScreen } from './StoryLogScreen';
import { UpgradesScreen } from './UpgradesScreen';

type TabKey = 'idle' | 'upgrades' | 'prestige' | 'story';

/**
 * Root screen. Owns the tab selection and the two modal interrupts; all game
 * state comes from the store and all mutation goes back through its actions.
 */
export function GameScreen(): ReactNode {
  useGameLoop();

  const [tab, setTab] = useState<TabKey>('idle');
  const game = useGameStore((store) => store.game);
  const hydrated = useGameStore((store) => store.hydrated);
  const pendingOffline = useGameStore((store) => store.pendingOffline);
  const chooseStoryOption = useGameStore((store) => store.chooseStoryOption);
  const dismissStory = useGameStore((store) => store.dismissStory);
  const acknowledgeOffline = useGameStore((store) => store.acknowledgeOffline);

  const resources = selectResourceRows(game);
  const story = selectActiveStory(game);
  const affordableUpgrades = selectUpgradeRows(game).filter((row) => row.affordable).length;
  const canAscend = selectPrestige(game).canAscend;

  const tabs: readonly TabDef[] = [
    { key: 'idle', label: 'Valley', icon: '🔥' },
    { key: 'upgrades', label: 'Craft', icon: '⚒', badge: affordableUpgrades },
    { key: 'prestige', label: 'Ascend', icon: '◈', badge: canAscend ? 1 : 0 },
    { key: 'story', label: 'Record', icon: '📖' },
  ];

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <ResourceBar rows={resources} />

      <View style={styles.body}>
        {!hydrated ? (
          <Text style={styles.loading}>Finding the coals…</Text>
        ) : (
          <>
            {tab === 'idle' ? <IdleScreen /> : null}
            {tab === 'upgrades' ? <UpgradesScreen /> : null}
            {tab === 'prestige' ? <PrestigeScreen /> : null}
            {tab === 'story' ? <StoryLogScreen /> : null}
          </>
        )}
      </View>

      <TabBar
        tabs={tabs}
        active={tab}
        onSelect={(key) => {
          setTab(key as TabKey);
        }}
      />

      {/* Offline is resolved before story so a returning player sees what they
          earned before being asked to make a decision about it. */}
      <OfflineModal summary={pendingOffline} onAcknowledge={acknowledgeOffline} />
      {pendingOffline === null ? (
        <StoryModal story={story} onChoose={chooseStoryOption} onDismiss={dismissStory} />
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  body: {
    flex: 1,
  },
  loading: {
    ...typography.body,
    color: colors.textFaint,
    textAlign: 'center',
    paddingTop: spacing.xl,
  },
});
