import { StakeRequest, StakeResponse, QueueStatusResponse } from '../types/api.types';
import { formatPhone } from './phoneUtils';

const API_BASE = '/api/v1';

export async function initiateStake(phone: string, stake: number): Promise<StakeResponse> {
  const response = await fetch(`${API_BASE}/game/stake`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      phone_number: formatPhone(phone),
      stake_amount: stake
    } as StakeRequest)
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || 'Failed to initiate stake');
  }

  // Ensure type safety even if backend returns extra fields
  return {
    player_id: data.player_id,
    status: data.status,
    game_link: data.game_link,
    display_name: data.display_name,
    my_display_name: data.my_display_name,
    opponent_display_name: data.opponent_display_name,
  } as StakeResponse;
}

export async function pollMatchStatus(playerId: string): Promise<QueueStatusResponse> {
  const response = await fetch(`${API_BASE}/game/queue/status?player_id=${playerId}`);
  const data = await response.json();
  
  if (!response.ok) {
    throw new Error(data.error || 'Failed to check match status');
  }
  
  return {
    status: data.status,
    game_link: data.game_link,
    my_display_name: data.my_display_name,
    opponent_display_name: data.opponent_display_name
  } as QueueStatusResponse;
}
