import { StakeRequest, StakeResponse, QueueStatusResponse } from '../types/api.types';
import { formatPhone } from './phoneUtils';

const API_BASE = '/api/v1';

export async function initiateStake(phone: string, stake: number, displayName?: string, opts?: { create_private?: boolean; match_code?: string; invite_phone?: string; source?: string; action_token?: string }): Promise<StakeResponse> {
  const body:any = {
    phone_number: formatPhone(phone),
    stake_amount: stake
  } as StakeRequest

  if (displayName) body.display_name = displayName
  if (opts?.create_private) body.create_private = true
  if (opts?.match_code) body.match_code = opts.match_code
  if (opts?.invite_phone) body.invite_phone = formatPhone(opts.invite_phone)
  if (opts?.source) body.source = opts.source
  if (opts?.action_token) body.action_token = opts.action_token

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
    transaction_id: data.transaction_id,
    dmark_transaction_id: data.dmark_transaction_id,
    message: data.message,
  } as StakeResponse;
}

export async function requeuePlayer(phone: string, queueId?: number, stakeAmount?: number, opts?: { mode?: 'private', invite_phone?: string }): Promise<any> {
  const body: any = {};
  if (queueId) body.queue_id = queueId;
  if (stakeAmount) body.stake_amount = stakeAmount;
  if (opts?.mode) body.mode = opts.mode;
  if (opts?.invite_phone) body.invite_phone = formatPhone(opts.invite_phone);

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

export async function pollMatchStatusByPhone(phone: string): Promise<QueueStatusResponse & { queue_token?: string }> {
  const response = await fetch(`${API_BASE}/game/queue/status?phone=${formatPhone(phone)}`);
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
    queue_token: data.queue_token,
  };
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

export async function getPlayerProfile(phone: string): Promise<{display_name?: string, player_winnings?: number, expired_queue?: {id:number, stake_amount:number, match_code?: string, is_private?: boolean}} | null> {
  const response = await fetch(`${API_BASE}/player/${formatPhone(phone)}`);
  if (response.status === 404) return null;

  const data = await response.json();
  if (!response.ok) {
    if (response.status >= 500) throw new Error('Server error, please try again later');
    throw new Error(data.error || 'Failed to fetch player');
  }

  return { 
    display_name: data.display_name, 
    player_winnings: data.player_winnings, 
    expired_queue: data.expired_queue 
  };
}

export async function getConfig(): Promise<{ commission_flat: number; payout_tax_percent: number; min_stake_amount: number; withdraw_provider_fee_percent?: number; min_withdraw_amount?: number }> {
  const response = await fetch(`${API_BASE}/config`);
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Failed to fetch config');
  }
  return {
    commission_flat: data.commission_flat,
    payout_tax_percent: data.payout_tax_percent,
    min_stake_amount: data.min_stake_amount,
    withdraw_provider_fee_percent: data.withdraw_provider_fee_percent,
    min_withdraw_amount: data.min_withdraw_amount,
  };
}

export async function requestOTP(phone: string): Promise<{ sms_queued: boolean }> {
  const response = await fetch(`${API_BASE}/auth/request-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: formatPhone(phone) })
  });

  const data = await response.json();
  if (!response.ok) {
    if (response.status === 429) throw new Error('Too many OTP requests. Please wait.');
    if (response.status >= 500) throw new Error('Server error, please try again later');
    throw new Error(data.error || 'Failed to request OTP');
  }
  return { sms_queued: data.sms_queued };
}

export async function verifyOTPAction(phone: string, code: string, action: string): Promise<{
  action_token: string;
  expires_at: string;
}> {
  const response = await fetch(`${API_BASE}/auth/verify-otp-action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: formatPhone(phone), code, action })
  });

  const data = await response.json();
  if (!response.ok) {
    if (response.status >= 500) throw new Error('Server error, please try again later');
    throw new Error(data.error || 'Failed to verify OTP');
  }
  return { action_token: data.action_token, expires_at: data.expires_at };
}

// PIN-related API functions

export async function checkPlayerStatus(phone: string): Promise<{
  exists: boolean;
  has_pin: boolean;
  display_name: string;
}> {
  const response = await fetch(`${API_BASE}/player/check?phone=${formatPhone(phone)}`);
  const data = await response.json();
  if (!response.ok) {
    if (response.status >= 500) throw new Error('Server error, please try again later');
    throw new Error(data.error || 'Failed to check player status');
  }
  return { exists: data.exists, has_pin: data.has_pin, display_name: data.display_name };
}

export async function setPIN(phone: string, pin: string): Promise<{ success: boolean }> {
  const response = await fetch(`${API_BASE}/auth/set-pin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: formatPhone(phone), pin })
  });

  const data = await response.json();
  if (!response.ok) {
    if (response.status >= 500) throw new Error('Server error, please try again later');
    throw new Error(data.error || 'Failed to set PIN');
  }
  return { success: data.success };
}

export async function verifyPIN(phone: string, pin: string, action: string): Promise<{
  action_token: string;
  expires_at: string;
  attempts_remaining?: number;
  locked_until?: string;
}> {
  const response = await fetch(`${API_BASE}/auth/verify-pin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: formatPhone(phone), pin, action })
  });

  const data = await response.json();
  if (!response.ok) {
    if (response.status === 429) {
      const err: any = new Error(data.error || 'Account locked');
      err.locked_until = data.locked_until;
      err.minutes_remaining = data.minutes_remaining;
      throw err;
    }
    if (response.status === 401) {
      const err: any = new Error(data.error || 'Incorrect PIN');
      err.attempts_remaining = data.attempts_remaining;
      throw err;
    }
    if (response.status >= 500) throw new Error('Server error, please try again later');
    throw new Error(data.error || 'Failed to verify PIN');
  }
  return { action_token: data.action_token, expires_at: data.expires_at };
}

export async function resetPIN(phone: string, newPin: string, actionToken: string): Promise<{ success: boolean }> {
  const response = await fetch(`${API_BASE}/auth/reset-pin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: formatPhone(phone), new_pin: newPin, action_token: actionToken })
  });

  const data = await response.json();
  if (!response.ok) {
    if (response.status >= 500) throw new Error('Server error, please try again later');
    throw new Error(data.error || 'Failed to reset PIN');
  }
  return { success: data.success };
}

export async function declineMatchInvite(phone: string, matchCode: string): Promise<{success: boolean}> {
  const response = await fetch(`${API_BASE}/match/decline`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      phone: formatPhone(phone), 
      match_code: matchCode 
    })
  });

  const data = await response.json();
  if (!response.ok) {
    if (response.status >= 500) throw new Error('Server error, please try again later');
    throw new Error(data.error || 'Failed to decline invite');
  }

  return { success: true };
}
