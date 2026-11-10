import type { WorldState } from './types'

export function clearNonGuideCampaigns(world: WorldState): WorldState {
  const removed = world.campaigns.filter((campaign) => campaign.templateType !== 'tour-guide')
  if (removed.length === 0) return world

  const removedCampaignIds = new Set(removed.map((campaign) => campaign.id))
  const removedNodeIds = new Set(removed.flatMap((campaign) => campaign.nodes.map((node) => node.id)))
  const removedSessionIds = new Set(world.sessions
    .filter((session) => removedCampaignIds.has(session.campaignId))
    .map((session) => session.id))
  const campaigns = world.campaigns.filter((campaign) => !removedCampaignIds.has(campaign.id))
  const available = campaigns.filter((campaign) => campaign.status !== 'archived')
  const activeCampaign = available.find((campaign) => campaign.id === world.profile.activeCampaignId) ?? available[0]

  return {
    ...world,
    profile: { ...world.profile, activeCampaignId: activeCampaign?.id },
    campaigns,
    sessions: world.sessions.filter((session) => !removedSessionIds.has(session.id)),
    evidence: world.evidence.filter((item) => !removedSessionIds.has(item.sessionId)),
    events: world.events.filter((event) =>
      (!event.campaignId || !removedCampaignIds.has(event.campaignId)) &&
      (!event.nodeId || !removedNodeIds.has(event.nodeId)) &&
      (!event.sessionId || !removedSessionIds.has(event.sessionId))
    ),
    mapHistories: world.mapHistories?.filter((history) => !removedCampaignIds.has(history.campaignId)),
    rewards: {
      ...world.rewards,
      transactions: world.rewards.transactions.filter((item) => !item.sessionId || !removedSessionIds.has(item.sessionId))
    }
  }
}
