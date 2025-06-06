//
// Copyright 2023 Signal Messenger, LLC.
// SPDX-License-Identifier: AGPL-3.0-only
//

//! Generates a new GenericServerSecretParams and encodes it using base64 and
//! [`bincode::serialize`].

use base64::prelude::{Engine, BASE64_STANDARD};
use rand::Rng;
use zkgroup::generic_server_params::GenericServerSecretParams;
use zkgroup::RANDOMNESS_LEN;

fn main() {
    let mut rng = rand::rng();
    let mut randomness = [0u8; RANDOMNESS_LEN];
    rng.fill(&mut randomness);

    let secret_params = GenericServerSecretParams::generate(randomness);
    let serialized_secret = bincode::serialize(&secret_params).unwrap();
    let serialized_public = bincode::serialize(&secret_params.get_public_params()).unwrap();

    println!("secret: {}", BASE64_STANDARD.encode(&serialized_secret[..]));
    println!("public: {}", BASE64_STANDARD.encode(&serialized_public[..]));
}
