import { StakeRequest, StakeResponse, QueueStatusResponse } from '../types/api.types';
import { formatPhone } from './phoneUtils';

const API_BASE = '/api/v1';

export async function initiateStake(phone: string, stake: number, displayName?: string, opts?: { create_private?: boolean; match_code?: string }): Promise<StakeResponse> {
  const body:any = {
    phone_number: formatPhone(phone),
    stake_amount: stake
  } as StakeRequest

  if (displayName) body.display_name = displayName
  if (opts?.create_private) body.create_private = true
  if (opts?.match_code) body.match_code = opts.match_code

  const response = await fetch(`${API_BASE}/game/stake`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const data = await response.json();

  if (!response.ok) {
    if (response.status >= 500) throw new Error('Server error, please try again later');
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
    queue_token: data.queue_token,
    match_code: data.match_code,
    expires_at: data.expires_at,
    queue_id: data.queue_id,
  } as StakeResponse;
}

export async function requeuePlayer(phone: string, queueId?: number, stakeAmount?: number): Promise<any> {
  const body: any = {};
  if (queueId) body.queue_id = queueId;
  if (stakeAmount) body.stake_amount = stakeAmount;

  const response = await fetch(`${API_BASE}/player/${formatPhone(phone)}/requeue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const data = await response.json();
  if (!response.ok) {
    if (response.status >= 500) throw new Error('Server error, please try again later');
    throw new Error(data.error || 'Failed to requeue');
  }
  return data;
}

export async function pollMatchStatus(queueToken: string): Promise<QueueStatusResponse> {
  const response = await fetch(`${API_BASE}/game/queue/status?queue_token=${queueToken}`);
  const data = await response.json();
  
  if (!response.ok) {
    throw new Error(data.error || 'Failed to check match status');
  }
  
  return {
    status: data.status,
    game_link: data.game_link,
    my_display_name: data.my_display_name,
    opponent_display_name: data.opponent_display_name,
    message: data.message,
  } as QueueStatusResponse;
}

export async function updateDisplayName(phone: string, name: string): Promise<{ display_name: string }> {
  const resp = await fetch(`${API_BASE}/player/${formatPhone(phone)}/display-name`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ display_name: name })
  });

  const data = await resp.json();
  if (!resp.ok) {
    if (resp.status >= 500) throw new Error('Server error, please try again later');
    throw new Error(data.error || 'Failed to update display name');
  }
  return { display_name: data.display_name };
}

export async function getPlayerProfile(phone: string): Promise<{display_name?: string, fee_exempt_balance?: number, expired_queue?: {id:number, stake_amount:number}} | null> {
  const response = await fetch(`${API_BASE}/player/${formatPhone(phone)}`);
  if (response.status === 404) return null;

  const data = await response.json();
  if (!response.ok) {
    if (response.status >= 500) throw new Error('Server error, please try again later');
    throw new Error(data.error || 'Failed to fetch player');
  }

  return { display_name: data.display_name, fee_exempt_balance: data.fee_exempt_balance, expired_queue: data.expired_queue };
}

export async function getConfig(): Promise<{ commission_flat: number; payout_tax_percent: number; min_stake_amount: number; }> {
  const response = await fetch(`${API_BASE}/config`);
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Failed to fetch config');
  }
  return {
    commission_flat: data.commission_flat,
    payout_tax_percent: data.payout_tax_percent,
    min_stake_amount: data.min_stake_amount,
  };
}
