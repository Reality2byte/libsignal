//
// Copyright 2024 Signal Messenger, LLC.
// SPDX-License-Identifier: AGPL-3.0-only
//

use std::collections::HashMap;
use std::ops::{Deref, DerefMut};

use libsignal_protocol::{ServiceId, ServiceIdFixedWidthBinaryBytes};
use rayon::iter::ParallelIterator as _;
use rayon::slice::ParallelSlice as _;

use crate::*;

/// Lazily parses ServiceIds from a buffer of concatenated Service-Id-FixedWidthBinary.
///
/// **Reports parse errors by panicking.** All errors represent mistakes on the app side of the
/// bridge, though; a buffer that really is constructed from concatenating service IDs should never
/// error.
#[derive(Clone, Copy, Debug)]
pub struct ServiceIdSequence<'a>(&'a [u8]);

impl<'a> ServiceIdSequence<'a> {
    const SERVICE_ID_FIXED_WIDTH_BINARY_LEN: usize =
        std::mem::size_of::<ServiceIdFixedWidthBinaryBytes>();

    pub fn parse(input: &'a [u8]) -> Self {
        let extra_bytes = input.len() % Self::SERVICE_ID_FIXED_WIDTH_BINARY_LEN;
        assert!(
            extra_bytes == 0,
            concat!(
                "input should be a concatenated list of Service-Id-FixedWidthBinary, ",
                "but has length {} ({} extra bytes)"
            ),
            input.len(),
            extra_bytes
        );
        Self(input)
    }

    fn parse_single_chunk(chunk: &[u8]) -> ServiceId {
        ServiceId::parse_from_service_id_fixed_width_binary(
            chunk.try_into().expect("correctly split"),
        )
        .expect(concat!(
            "input should be a concatenated list of Service-Id-FixedWidthBinary, ",
            "but one ServiceId was invalid"
        ))
    }
}

impl<'a> IntoIterator for ServiceIdSequence<'a> {
    type IntoIter = std::iter::Map<std::slice::ChunksExact<'a, u8>, fn(&[u8]) -> ServiceId>;
    type Item = ServiceId;

    fn into_iter(self) -> Self::IntoIter {
        self.0
            .chunks_exact(Self::SERVICE_ID_FIXED_WIDTH_BINARY_LEN)
            .map(Self::parse_single_chunk)
    }
}

impl<'a> rayon::iter::IntoParallelIterator for ServiceIdSequence<'a> {
    type Iter = rayon::iter::Map<rayon::slice::ChunksExact<'a, u8>, fn(&[u8]) -> ServiceId>;
    type Item = ServiceId;

    fn into_par_iter(self) -> Self::Iter {
        self.0
            .par_chunks_exact(Self::SERVICE_ID_FIXED_WIDTH_BINARY_LEN)
            .map(Self::parse_single_chunk)
    }
}

#[derive(Default, Debug, PartialEq, Eq, Clone)]
pub struct BridgedStringMap(HashMap<String, String>);

impl BridgedStringMap {
    pub fn with_capacity(capacity: usize) -> Self {
        Self(HashMap::with_capacity(capacity))
    }

    pub fn take(&mut self) -> HashMap<String, String> {
        std::mem::take(&mut self.0)
    }
}

impl Deref for BridgedStringMap {
    type Target = HashMap<String, String>;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}
impl DerefMut for BridgedStringMap {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.0
    }
}
impl From<BridgedStringMap> for HashMap<String, String> {
    fn from(value: BridgedStringMap) -> Self {
        value.0
    }
}

bridge_as_handle!(BridgedStringMap, mut = true);
