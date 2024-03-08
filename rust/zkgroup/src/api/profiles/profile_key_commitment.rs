//
// Copyright 2020 Signal Messenger, LLC.
// SPDX-License-Identifier: AGPL-3.0-only
//

use crate::common::serialization::ReservedByte;

use crate::crypto;
use partial_default::PartialDefault;
use serde::{Deserialize, Serialize};

#[derive(Copy, Clone, Serialize, Deserialize, PartialDefault)]
pub struct ProfileKeyCommitment {
    pub(crate) reserved: ReservedByte,
    pub(crate) commitment: crypto::profile_key_commitment::Commitment,
}
