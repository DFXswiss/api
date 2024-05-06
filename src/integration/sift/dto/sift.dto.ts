export enum EventType {
  CREATE_ACCOUNT = '$create_account',
}

export interface SiftBase {
  $type: EventType;
  $api_key: string;
  $user_id: string;
  $ip: string;
  $time: number;
}

export interface CreateAccount extends SiftBase {
  $session_id?: string;
  $user_email?: string;
  $verification_phone_number?: string;
  $name?: string;
  $phone?: string;
  $referrer_user_id?: string;
  $payment_methods?: [
    {
      $payment_type?: string;
      $card_bin?: string;
      $card_last4?: string;
    },
  ];
  $billing_address?: {
    $name?: string;
    $phone?: string;
    $address_1?: string;
    $address_2?: string;
    $city?: string;
    $region?: string;
    $country?: string;
    $zipcode?: string;
  };
  $shipping_address?: {
    $name?: string;
    $phone?: string;
    $address_1?: string;
    $address_2?: string;
    $city?: string;
    $region?: string;
    $country?: string;
    $zipcode?: string;
  };
  $promotions?: [
    {
      $promotion_id?: string;
      $status?: string;
      $referrer_user_id?: string;
      $credit_point?: {
        $amount?: number;
        $credit_point_type?: string;
      };
    },
  ];

  $social_sign_on_type?: string;
  $account_types?: [string];

  twitter_handle?: string;
  work_phone?: string;
  location?: string;
  referral_code?: string;
  email_confirmed_status?: string;
  phone_confirmed_status?: string;

  $browser?: {
    $user_agent?: string;
    $accept_language?: string;
    $content_language?: string;
  };

  $app?: {
    $os?: string;
    $os_version?: string;
    $device_manufacturer?: string;
    $device_model?: string;
    $device_unique_id?: string;
    $app_name?: string;
    $app_version?: string;
    $client_language?: string;
  };

  //Custom fields
  blockchain_address: string;
}
