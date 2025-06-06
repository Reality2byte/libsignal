//
// Copyright 2021-2022 Signal Messenger, LLC.
// SPDX-License-Identifier: AGPL-3.0-only
//

/* eslint-disable @typescript-eslint/require-await */

import * as SignalClient from '../index';
import * as util from './util';

import { assert, use } from 'chai';
import * as chaiAsPromised from 'chai-as-promised';
import * as Chance from 'chance';
import * as uuid from 'uuid';

use(chaiAsPromised);
util.initLogger();

const chance = Chance();

class InMemorySessionStore extends SignalClient.SessionStore {
  private state = new Map<string, Buffer>();
  async saveSession(
    name: SignalClient.ProtocolAddress,
    record: SignalClient.SessionRecord
  ): Promise<void> {
    const idx = `${name.name()}::${name.deviceId()}`;
    this.state.set(idx, record.serialize());
  }
  async getSession(
    name: SignalClient.ProtocolAddress
  ): Promise<SignalClient.SessionRecord | null> {
    const idx = `${name.name()}::${name.deviceId()}`;
    const serialized = this.state.get(idx);
    if (serialized) {
      return SignalClient.SessionRecord.deserialize(serialized);
    } else {
      return null;
    }
  }
  async getExistingSessions(
    addresses: SignalClient.ProtocolAddress[]
  ): Promise<SignalClient.SessionRecord[]> {
    return addresses.map((address) => {
      const idx = `${address.name()}::${address.deviceId()}`;
      const serialized = this.state.get(idx);
      if (!serialized) {
        throw `no session for ${idx}`;
      }
      return SignalClient.SessionRecord.deserialize(serialized);
    });
  }
}

class InMemoryIdentityKeyStore extends SignalClient.IdentityKeyStore {
  private idKeys = new Map<string, SignalClient.PublicKey>();
  private localRegistrationId: number;
  private identityKey: SignalClient.PrivateKey;

  constructor(localRegistrationId?: number) {
    super();
    this.identityKey = SignalClient.PrivateKey.generate();
    this.localRegistrationId = localRegistrationId ?? 5;
  }

  async getIdentityKey(): Promise<SignalClient.PrivateKey> {
    return this.identityKey;
  }
  async getLocalRegistrationId(): Promise<number> {
    return this.localRegistrationId;
  }

  async isTrustedIdentity(
    name: SignalClient.ProtocolAddress,
    key: SignalClient.PublicKey,
    _direction: SignalClient.Direction
  ): Promise<boolean> {
    const idx = `${name.name()}::${name.deviceId()}`;
    const currentKey = this.idKeys.get(idx);
    if (currentKey) {
      return currentKey.compare(key) == 0;
    } else {
      return true;
    }
  }

  async saveIdentity(
    name: SignalClient.ProtocolAddress,
    key: SignalClient.PublicKey
  ): Promise<SignalClient.IdentityChange> {
    const idx = `${name.name()}::${name.deviceId()}`;
    const currentKey = this.idKeys.get(idx);
    this.idKeys.set(idx, key);

    const changed = (currentKey?.compare(key) ?? 0) != 0;
    return changed
      ? SignalClient.IdentityChange.ReplacedExisting
      : SignalClient.IdentityChange.NewOrUnchanged;
  }
  async getIdentity(
    name: SignalClient.ProtocolAddress
  ): Promise<SignalClient.PublicKey | null> {
    const idx = `${name.name()}::${name.deviceId()}`;
    return this.idKeys.get(idx) ?? null;
  }
}

class InMemoryPreKeyStore extends SignalClient.PreKeyStore {
  private state = new Map<number, Buffer>();
  async savePreKey(
    id: number,
    record: SignalClient.PreKeyRecord
  ): Promise<void> {
    this.state.set(id, record.serialize());
  }
  async getPreKey(id: number): Promise<SignalClient.PreKeyRecord> {
    const record = this.state.get(id);
    if (!record) {
      throw new Error(`pre-key ${id} not found`);
    }
    return SignalClient.PreKeyRecord.deserialize(record);
  }
  async removePreKey(id: number): Promise<void> {
    this.state.delete(id);
  }
}

class InMemorySignedPreKeyStore extends SignalClient.SignedPreKeyStore {
  private state = new Map<number, Buffer>();
  async saveSignedPreKey(
    id: number,
    record: SignalClient.SignedPreKeyRecord
  ): Promise<void> {
    this.state.set(id, record.serialize());
  }
  async getSignedPreKey(id: number): Promise<SignalClient.SignedPreKeyRecord> {
    const record = this.state.get(id);
    if (!record) {
      throw new Error(`pre-key ${id} not found`);
    }
    return SignalClient.SignedPreKeyRecord.deserialize(record);
  }
}

class InMemoryKyberPreKeyStore extends SignalClient.KyberPreKeyStore {
  private state = new Map<number, Buffer>();
  private used = new Set<number>();
  async saveKyberPreKey(
    id: number,
    record: SignalClient.KyberPreKeyRecord
  ): Promise<void> {
    this.state.set(id, record.serialize());
  }
  async getKyberPreKey(id: number): Promise<SignalClient.KyberPreKeyRecord> {
    const record = this.state.get(id);
    if (!record) {
      throw new Error(`kyber pre-key ${id} not found`);
    }
    return SignalClient.KyberPreKeyRecord.deserialize(record);
  }
  async markKyberPreKeyUsed(id: number): Promise<void> {
    this.used.add(id);
  }
  async hasKyberPreKeyBeenUsed(id: number): Promise<boolean> {
    return this.used.has(id);
  }
}

class InMemorySenderKeyStore extends SignalClient.SenderKeyStore {
  private state = new Map<string, SignalClient.SenderKeyRecord>();
  async saveSenderKey(
    sender: SignalClient.ProtocolAddress,
    distributionId: SignalClient.Uuid,
    record: SignalClient.SenderKeyRecord
  ): Promise<void> {
    const idx = `${distributionId}::${sender.name()}::${sender.deviceId()}`;
    this.state.set(idx, record);
  }
  async getSenderKey(
    sender: SignalClient.ProtocolAddress,
    distributionId: SignalClient.Uuid
  ): Promise<SignalClient.SenderKeyRecord | null> {
    const idx = `${distributionId}::${sender.name()}::${sender.deviceId()}`;
    return this.state.get(idx) ?? null;
  }
}

class TestStores {
  sender: InMemorySenderKeyStore;
  prekey: InMemoryPreKeyStore;
  signed: InMemorySignedPreKeyStore;
  kyber: InMemoryKyberPreKeyStore;
  identity: InMemoryIdentityKeyStore;
  session: InMemorySessionStore;

  constructor() {
    this.sender = new InMemorySenderKeyStore();
    this.prekey = new InMemoryPreKeyStore();
    this.signed = new InMemorySignedPreKeyStore();
    this.kyber = new InMemoryKyberPreKeyStore();
    this.identity = new InMemoryIdentityKeyStore();
    this.session = new InMemorySessionStore();
  }
}

async function makePQXDHBundle(
  address: SignalClient.ProtocolAddress,
  stores: TestStores
): Promise<SignalClient.PreKeyBundle> {
  const identityKey = await stores.identity.getIdentityKey();
  const prekeyId = chance.natural({ max: 10000 });
  const prekey = SignalClient.PrivateKey.generate();
  const signedPrekeyId = chance.natural({ max: 10000 });
  const signedPrekey = SignalClient.PrivateKey.generate();
  const signedPrekeySignature = identityKey.sign(
    signedPrekey.getPublicKey().serialize()
  );
  const kyberPrekeyId = chance.natural({ max: 10000 });
  const kyberKeyPair = SignalClient.KEMKeyPair.generate();
  const kyberPrekeySignature = identityKey.sign(
    kyberKeyPair.getPublicKey().serialize()
  );

  await stores.prekey.savePreKey(
    prekeyId,
    SignalClient.PreKeyRecord.new(prekeyId, prekey.getPublicKey(), prekey)
  );

  await stores.signed.saveSignedPreKey(
    signedPrekeyId,
    SignalClient.SignedPreKeyRecord.new(
      signedPrekeyId,
      chance.timestamp(),
      signedPrekey.getPublicKey(),
      signedPrekey,
      signedPrekeySignature
    )
  );

  await stores.kyber.saveKyberPreKey(
    kyberPrekeyId,
    SignalClient.KyberPreKeyRecord.new(
      kyberPrekeyId,
      chance.timestamp(),
      kyberKeyPair,
      kyberPrekeySignature
    )
  );

  return SignalClient.PreKeyBundle.new(
    await stores.identity.getLocalRegistrationId(),
    address.deviceId(),
    prekeyId,
    prekey.getPublicKey(),
    signedPrekeyId,
    signedPrekey.getPublicKey(),
    signedPrekeySignature,
    identityKey.getPublicKey(),
    kyberPrekeyId,
    kyberKeyPair.getPublicKey(),
    kyberPrekeySignature
  );
}

const sessionVersionTestCases = [
  { suffix: 'v4', makeBundle: makePQXDHBundle, expectedVersion: 4 },
];

describe('SignalClient', () => {
  it('HKDF test vector', () => {
    const secret = Buffer.from(
      '0B0B0B0B0B0B0B0B0B0B0B0B0B0B0B0B0B0B0B0B0B0B',
      'hex'
    );
    const empty = Buffer.from('', 'hex');

    assert.deepEqual(
      SignalClient.hkdf(42, secret, empty, empty).toString('hex'),
      '8da4e775a563c18f715f802a063c5a31b8a11f5c5ee1879ec3454e5f3c738d2d9d201395faa4b61a96c8'
    );

    assert.deepEqual(
      SignalClient.hkdf(42, secret, empty, null).toString('hex'),
      '8da4e775a563c18f715f802a063c5a31b8a11f5c5ee1879ec3454e5f3c738d2d9d201395faa4b61a96c8'
    );

    const salt = Buffer.from('000102030405060708090A0B0C', 'hex');
    const label = Buffer.from('F0F1F2F3F4F5F6F7F8F9', 'hex');

    assert.deepEqual(
      SignalClient.hkdf(42, secret, label, salt).toString('hex'),
      '3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865'
    );
  });
  describe('ServiceId', () => {
    const testingUuid = '8c78cd2a-16ff-427d-83dc-1a5e36ce713d';

    it('handles ACIs', () => {
      const aci = SignalClient.Aci.fromUuid(testingUuid);
      assert.instanceOf(aci, SignalClient.Aci);
      assert.isTrue(
        aci.isEqual(SignalClient.Aci.fromUuidBytes(uuid.parse(testingUuid)))
      );
      assert.isFalse(aci.isEqual(SignalClient.Pni.fromUuid(testingUuid)));

      assert.deepEqual(testingUuid, aci.getRawUuid());
      assert.deepEqual(uuid.parse(testingUuid), aci.getRawUuidBytes());
      assert.deepEqual(testingUuid, aci.getServiceIdString());
      assert.deepEqual(uuid.parse(testingUuid), aci.getServiceIdBinary());
      assert.deepEqual(`<ACI:${testingUuid}>`, `${aci}`);

      {
        const aciServiceId = SignalClient.ServiceId.parseFromServiceIdString(
          aci.getServiceIdString()
        );
        assert.instanceOf(aciServiceId, SignalClient.Aci);
        assert.deepEqual(aci, aciServiceId);

        const _: SignalClient.Aci = SignalClient.Aci.parseFromServiceIdString(
          aci.getServiceIdString()
        );
      }

      {
        const aciServiceId = SignalClient.ServiceId.parseFromServiceIdBinary(
          aci.getServiceIdBinary()
        );
        assert.instanceOf(aciServiceId, SignalClient.Aci);
        assert.deepEqual(aci, aciServiceId);

        const _: SignalClient.Aci = SignalClient.Aci.parseFromServiceIdBinary(
          aci.getServiceIdBinary()
        );
      }
    });
    it('handles PNIs', () => {
      const pni = SignalClient.Pni.fromUuid(testingUuid);
      assert.instanceOf(pni, SignalClient.Pni);
      assert.isTrue(
        pni.isEqual(SignalClient.Pni.fromUuidBytes(uuid.parse(testingUuid)))
      );
      assert.isFalse(pni.isEqual(SignalClient.Aci.fromUuid(testingUuid)));

      assert.deepEqual(testingUuid, pni.getRawUuid());
      assert.deepEqual(uuid.parse(testingUuid), pni.getRawUuidBytes());
      assert.deepEqual(`PNI:${testingUuid}`, pni.getServiceIdString());
      assert.deepEqual(
        Buffer.concat([Buffer.of(0x01), pni.getRawUuidBytes()]),
        pni.getServiceIdBinary()
      );
      assert.deepEqual(`<PNI:${testingUuid}>`, `${pni}`);

      {
        const pniServiceId = SignalClient.ServiceId.parseFromServiceIdString(
          pni.getServiceIdString()
        );
        assert.instanceOf(pniServiceId, SignalClient.Pni);
        assert.deepEqual(pni, pniServiceId);

        const _: SignalClient.Pni = SignalClient.Pni.parseFromServiceIdString(
          pni.getServiceIdString()
        );
      }

      {
        const pniServiceId = SignalClient.ServiceId.parseFromServiceIdBinary(
          pni.getServiceIdBinary()
        );
        assert.instanceOf(pniServiceId, SignalClient.Pni);
        assert.deepEqual(pni, pniServiceId);

        const _: SignalClient.Pni = SignalClient.Pni.parseFromServiceIdBinary(
          pni.getServiceIdBinary()
        );
      }
    });
    it('accepts the null UUID', () => {
      SignalClient.ServiceId.parseFromServiceIdString(uuid.NIL);
    });
    it('rejects invalid values', () => {
      assert.throws(() =>
        SignalClient.ServiceId.parseFromServiceIdBinary(Buffer.of())
      );
      assert.throws(() => SignalClient.ServiceId.parseFromServiceIdString(''));
    });
    it('follows the standard ordering', () => {
      const original = [
        SignalClient.Aci.fromUuid(uuid.NIL),
        SignalClient.Aci.fromUuid(testingUuid),
        SignalClient.Pni.fromUuid(uuid.NIL),
        SignalClient.Pni.fromUuid(testingUuid),
      ];
      const ids = util.shuffled(original);
      ids.sort(SignalClient.ServiceId.comparator);
      assert.deepEqual(ids, original);
    });
  });
  describe('ProtocolAddress', () => {
    it('can hold arbitrary data', () => {
      const addr = SignalClient.ProtocolAddress.new('name', 42);
      assert.deepEqual(addr.name(), 'name');
      assert.deepEqual(addr.deviceId(), 42);
    });
    it('can round-trip ServiceIds', () => {
      const newUuid = uuid.v4();
      const aci = SignalClient.Aci.fromUuid(newUuid);
      const pni = SignalClient.Pni.fromUuid(newUuid);

      const aciAddr = SignalClient.ProtocolAddress.new(aci, 1);
      const pniAddr = SignalClient.ProtocolAddress.new(pni, 1);
      assert.notEqual(aciAddr.toString(), pniAddr.toString());
      assert.isTrue(aciAddr.serviceId()?.isEqual(aci));
      assert.isTrue(pniAddr.serviceId()?.isEqual(pni));
    });
  });
  it('Fingerprint', () => {
    const aliceKey = SignalClient.PublicKey.deserialize(
      Buffer.from(
        '0506863bc66d02b40d27b8d49ca7c09e9239236f9d7d25d6fcca5ce13c7064d868',
        'hex'
      )
    );
    const aliceIdentifier = Buffer.from('+14152222222', 'utf8');
    const bobKey = SignalClient.PublicKey.deserialize(
      Buffer.from(
        '05f781b6fb32fed9ba1cf2de978d4d5da28dc34046ae814402b5c0dbd96fda907b',
        'hex'
      )
    );
    const bobIdentifier = Buffer.from('+14153333333', 'utf8');
    const iterations = 5200;
    const aFprint1 = SignalClient.Fingerprint.new(
      iterations,
      1,
      aliceIdentifier,
      aliceKey,
      bobIdentifier,
      bobKey
    );

    assert.deepEqual(
      aFprint1.scannableFingerprint().toBuffer().toString('hex'),
      '080112220a201e301a0353dce3dbe7684cb8336e85136cdc0ee96219494ada305d62a7bd61df1a220a20d62cbf73a11592015b6b9f1682ac306fea3aaf3885b84d12bca631e9d4fb3a4d'
    );

    assert.deepEqual(
      aFprint1.displayableFingerprint().toString(),
      '300354477692869396892869876765458257569162576843440918079131'
    );

    const bFprint1 = SignalClient.Fingerprint.new(
      iterations,
      1,
      bobIdentifier,
      bobKey,
      aliceIdentifier,
      aliceKey
    );

    assert.deepEqual(
      bFprint1.scannableFingerprint().toBuffer().toString('hex'),
      '080112220a20d62cbf73a11592015b6b9f1682ac306fea3aaf3885b84d12bca631e9d4fb3a4d1a220a201e301a0353dce3dbe7684cb8336e85136cdc0ee96219494ada305d62a7bd61df'
    );
    assert.deepEqual(
      bFprint1.displayableFingerprint().toString(),
      '300354477692869396892869876765458257569162576843440918079131'
    );

    assert(
      aFprint1.scannableFingerprint().compare(bFprint1.scannableFingerprint())
    );
    assert(
      bFprint1.scannableFingerprint().compare(aFprint1.scannableFingerprint())
    );

    assert.isNotTrue(
      aFprint1.scannableFingerprint().compare(aFprint1.scannableFingerprint())
    );
    assert.isNotTrue(
      bFprint1.scannableFingerprint().compare(bFprint1.scannableFingerprint())
    );
  });
  it('SenderCertificate', () => {
    const trustRoot = SignalClient.PrivateKey.generate();
    const serverKey = SignalClient.PrivateKey.generate();

    const keyId = 23;

    const serverCert = SignalClient.ServerCertificate.new(
      keyId,
      serverKey.getPublicKey(),
      trustRoot
    );
    assert.deepEqual(serverCert.keyId(), keyId);
    assert.deepEqual(serverCert.key(), serverKey.getPublicKey());

    const serverCertFromBytes = SignalClient.ServerCertificate.deserialize(
      serverCert.serialize()
    );
    assert.deepEqual(serverCert, serverCertFromBytes);

    const senderUuid = 'fedfe51e-2b91-4156-8710-7cc1bdd57cd8';
    const senderE164 = '555-123-4567';
    const senderDeviceId = 9;
    const senderKey = SignalClient.PrivateKey.generate();
    const expiration = 2114398800; // Jan 1, 2037

    const senderCert = SignalClient.SenderCertificate.new(
      senderUuid,
      senderE164,
      senderDeviceId,
      senderKey.getPublicKey(),
      expiration,
      serverCert,
      serverKey
    );

    assert.deepEqual(senderCert.serverCertificate(), serverCert);
    assert.deepEqual(senderCert.senderUuid(), senderUuid);
    assert.deepEqual(senderCert.senderAci()?.getRawUuid(), senderUuid);
    assert.deepEqual(senderCert.senderE164(), senderE164);
    assert.deepEqual(senderCert.senderDeviceId(), senderDeviceId);

    const senderCertFromBytes = SignalClient.SenderCertificate.deserialize(
      senderCert.serialize()
    );
    assert.deepEqual(senderCert, senderCertFromBytes);

    assert(senderCert.validate(trustRoot.getPublicKey(), expiration - 1000));
    assert(!senderCert.validate(trustRoot.getPublicKey(), expiration + 10)); // expired

    const senderCertWithoutE164 = SignalClient.SenderCertificate.new(
      senderUuid,
      null,
      senderDeviceId,
      senderKey.getPublicKey(),
      expiration,
      serverCert,
      serverKey
    );

    assert.deepEqual(senderCertWithoutE164.serverCertificate(), serverCert);
    assert.deepEqual(senderCertWithoutE164.senderUuid(), senderUuid);
    assert.deepEqual(
      senderCertWithoutE164.senderAci()?.getRawUuid(),
      senderUuid
    );
    assert.isNull(senderCertWithoutE164.senderE164());
    assert.deepEqual(senderCertWithoutE164.senderDeviceId(), senderDeviceId);
  });
  it('SenderKeyMessage', () => {
    const distributionId = 'd1d1d1d1-7000-11eb-b32a-33b8a8a487a6';
    const chainId = 9;
    const iteration = 101;
    const ciphertext = Buffer.alloc(32, 0xfe);
    const pk = SignalClient.PrivateKey.generate();

    const skm = SignalClient.SenderKeyMessage._new(
      3,
      distributionId,
      chainId,
      iteration,
      ciphertext,
      pk
    );
    assert.deepEqual(skm.distributionId(), distributionId);
    assert.deepEqual(skm.chainId(), chainId);
    assert.deepEqual(skm.iteration(), iteration);
    assert.deepEqual(skm.ciphertext(), ciphertext);

    assert(skm.verifySignature(pk.getPublicKey()));

    const skmFromBytes = SignalClient.SenderKeyMessage.deserialize(
      skm.serialize()
    );
    assert.deepEqual(skm, skmFromBytes);
  });
  it('SenderKeyDistributionMessage', () => {
    const distributionId = 'd1d1d1d1-7000-11eb-b32a-33b8a8a487a6';
    const chainId = 9;
    const iteration = 101;
    const chainKey = Buffer.alloc(32, 0xfe);
    const pk = SignalClient.PrivateKey.generate();

    const skdm = SignalClient.SenderKeyDistributionMessage._new(
      3,
      distributionId,
      chainId,
      iteration,
      chainKey,
      pk.getPublicKey()
    );
    assert.deepEqual(skdm.distributionId(), distributionId);
    assert.deepEqual(skdm.chainId(), chainId);
    assert.deepEqual(skdm.iteration(), iteration);
    assert.deepEqual(skdm.chainKey(), chainKey);

    const skdmFromBytes = SignalClient.SenderKeyDistributionMessage.deserialize(
      skdm.serialize()
    );
    assert.deepEqual(skdm, skdmFromBytes);
  });
  describe('SenderKeyDistributionMessage Store API', () => {
    it('can encrypt and decrypt', async () => {
      const sender = SignalClient.ProtocolAddress.new('sender', 1);
      const distributionId = 'd1d1d1d1-7000-11eb-b32a-33b8a8a487a6';
      const aSenderKeyStore = new InMemorySenderKeyStore();
      const skdm = await SignalClient.SenderKeyDistributionMessage.create(
        sender,
        distributionId,
        aSenderKeyStore
      );
      assert.equal(distributionId, skdm.distributionId());
      assert.equal(0, skdm.iteration());

      const bSenderKeyStore = new InMemorySenderKeyStore();
      await SignalClient.processSenderKeyDistributionMessage(
        sender,
        skdm,
        bSenderKeyStore
      );

      const message = Buffer.from('0a0b0c', 'hex');

      const aCtext = await SignalClient.groupEncrypt(
        sender,
        distributionId,
        aSenderKeyStore,
        message
      );

      const bPtext = await SignalClient.groupDecrypt(
        sender,
        bSenderKeyStore,
        aCtext.serialize()
      );

      assert.deepEqual(message, bPtext);

      const anotherSkdm =
        await SignalClient.SenderKeyDistributionMessage.create(
          sender,
          distributionId,
          aSenderKeyStore
        );
      assert.equal(skdm.chainId(), anotherSkdm.chainId());
      assert.equal(1, anotherSkdm.iteration());
    });

    it("does not panic if there's an error", async () => {
      const sender = SignalClient.ProtocolAddress.new('sender', 1);
      const distributionId = 'd1d1d1d1-7000-11eb-b32a-33b8a8a487a6';
      const aSenderKeyStore = new InMemorySenderKeyStore();

      const messagePromise = SignalClient.SenderKeyDistributionMessage.create(
        sender,
        distributionId,
        undefined as unknown as SignalClient.SenderKeyStore
      );
      await assert.isRejected(messagePromise, TypeError);

      const messagePromise2 = SignalClient.SenderKeyDistributionMessage.create(
        {} as unknown as SignalClient.ProtocolAddress,
        distributionId,
        aSenderKeyStore
      );
      await assert.isRejected(messagePromise2, TypeError);
    });
  });

  it('PublicKeyBundle Kyber', () => {
    const signingKey = SignalClient.PrivateKey.generate();
    const registrationId = 5;
    const deviceId = 23;
    const prekeyId = 42;
    const prekey = SignalClient.PrivateKey.generate().getPublicKey();
    const signedPrekeyId = 2300;
    const signedPrekey = SignalClient.PrivateKey.generate().getPublicKey();
    const signedPrekeySignature = signingKey.sign(signedPrekey.serialize());
    const identityKey = SignalClient.PrivateKey.generate().getPublicKey();
    const kyberPrekeyId = 8888;
    const kyberPrekey = SignalClient.KEMKeyPair.generate().getPublicKey();
    const kyberPrekeySignature = signingKey.sign(kyberPrekey.serialize());

    const pkb = SignalClient.PreKeyBundle.new(
      registrationId,
      deviceId,
      prekeyId,
      prekey,
      signedPrekeyId,
      signedPrekey,
      signedPrekeySignature,
      identityKey,
      kyberPrekeyId,
      kyberPrekey,
      kyberPrekeySignature
    );

    assert.deepEqual(pkb.registrationId(), registrationId);
    assert.deepEqual(pkb.deviceId(), deviceId);
    assert.deepEqual(pkb.preKeyId(), prekeyId);
    assert.deepEqual(pkb.preKeyPublic(), prekey);
    assert.deepEqual(pkb.signedPreKeyId(), signedPrekeyId);
    assert.deepEqual(pkb.signedPreKeyPublic(), signedPrekey);
    assert.deepEqual(pkb.signedPreKeySignature(), signedPrekeySignature);
    assert.deepEqual(pkb.identityKey(), identityKey);
    assert.deepEqual(pkb.kyberPreKeyId(), kyberPrekeyId);
    assert.deepEqual(pkb.kyberPreKeyPublic(), kyberPrekey);
    assert.deepEqual(pkb.kyberPreKeySignature(), kyberPrekeySignature);

    // no one-time EC pre-key
    const pkb2 = SignalClient.PreKeyBundle.new(
      registrationId,
      deviceId,
      null,
      null,
      signedPrekeyId,
      signedPrekey,
      signedPrekeySignature,
      identityKey,
      kyberPrekeyId,
      kyberPrekey,
      kyberPrekeySignature
    );

    assert.deepEqual(pkb2.registrationId(), registrationId);
    assert.deepEqual(pkb2.deviceId(), deviceId);
    assert.deepEqual(pkb2.preKeyId(), null);
    assert.deepEqual(pkb2.preKeyPublic(), null);
    assert.deepEqual(pkb2.signedPreKeyId(), signedPrekeyId);
    assert.deepEqual(pkb2.signedPreKeyPublic(), signedPrekey);
    assert.deepEqual(pkb2.signedPreKeySignature(), signedPrekeySignature);
    assert.deepEqual(pkb2.identityKey(), identityKey);
    assert.deepEqual(pkb2.kyberPreKeyId(), kyberPrekeyId);
    assert.deepEqual(pkb2.kyberPreKeyPublic(), kyberPrekey);
    assert.deepEqual(pkb2.kyberPreKeySignature(), kyberPrekeySignature);
  });

  it('PreKeyRecord', () => {
    const privKey = SignalClient.PrivateKey.generate();
    const pubKey = privKey.getPublicKey();
    const pkr = SignalClient.PreKeyRecord.new(23, pubKey, privKey);

    assert.deepEqual(pkr.id(), 23);
    assert.deepEqual(pkr.publicKey(), pubKey);
    assert.deepEqual(pkr.privateKey(), privKey);

    const pkr2 = SignalClient.PreKeyRecord.deserialize(pkr.serialize());
    assert.deepEqual(pkr2.id(), 23);
    assert.deepEqual(pkr2.publicKey(), pubKey);
    assert.deepEqual(pkr2.privateKey(), privKey);
  });
  it('SignedPreKeyRecord', () => {
    const privKey = SignalClient.PrivateKey.generate();
    const pubKey = privKey.getPublicKey();
    const timestamp = 9000;
    const keyId = 23;
    const signature = Buffer.alloc(64, 64);
    const spkr = SignalClient.SignedPreKeyRecord.new(
      keyId,
      timestamp,
      pubKey,
      privKey,
      signature
    );

    assert.deepEqual(spkr.id(), keyId);
    assert.deepEqual(spkr.timestamp(), timestamp);
    assert.deepEqual(spkr.publicKey(), pubKey);
    assert.deepEqual(spkr.privateKey(), privKey);
    assert.deepEqual(spkr.signature(), signature);

    const spkrFromBytes = SignalClient.SignedPreKeyRecord.deserialize(
      spkr.serialize()
    );
    assert.deepEqual(spkrFromBytes, spkr);
  });

  it('KyberPreKeyRecord', () => {
    const keyPair = SignalClient.KEMKeyPair.generate();
    const publicKey = keyPair.getPublicKey();
    const secretKey = keyPair.getSecretKey();
    const timestamp = 9000;
    const keyId = 23;
    const signature = Buffer.alloc(64, 64);
    const record = SignalClient.KyberPreKeyRecord.new(
      keyId,
      timestamp,
      keyPair,
      signature
    );

    assert.deepEqual(record.id(), keyId);
    assert.deepEqual(record.timestamp(), timestamp);
    assert.deepEqual(record.keyPair(), keyPair);
    assert.deepEqual(record.publicKey(), publicKey);
    assert.deepEqual(record.secretKey(), secretKey);
    assert.deepEqual(record.signature(), signature);

    const recordFromBytes = SignalClient.KyberPreKeyRecord.deserialize(
      record.serialize()
    );
    assert.deepEqual(recordFromBytes, record);
  });

  it('SignalMessage and PreKeySignalMessage', () => {
    const messageVersion = 3;
    const macKey = Buffer.alloc(32, 0xab);
    const senderRatchetKey = SignalClient.PrivateKey.generate().getPublicKey();
    const counter = 9;
    const previousCounter = 8;
    const senderIdentityKey = SignalClient.PrivateKey.generate().getPublicKey();
    const receiverIdentityKey =
      SignalClient.PrivateKey.generate().getPublicKey();
    const ciphertext = Buffer.from('01020304', 'hex');

    const sm = SignalClient.SignalMessage._new(
      messageVersion,
      macKey,
      senderRatchetKey,
      counter,
      previousCounter,
      ciphertext,
      senderIdentityKey,
      receiverIdentityKey
    );

    assert.deepEqual(sm.counter(), counter);
    assert.deepEqual(sm.messageVersion(), messageVersion);

    const sm_bytes = sm.serialize();

    const sm2 = SignalClient.SignalMessage.deserialize(sm_bytes);

    assert.deepEqual(sm.body(), sm2.body());

    const registrationId = 9;
    const preKeyId = 23;
    const signedPreKeyId = 802;
    const baseKey = SignalClient.PrivateKey.generate().getPublicKey();
    const identityKey = SignalClient.PrivateKey.generate().getPublicKey();

    const pkm = SignalClient.PreKeySignalMessage._new(
      messageVersion,
      registrationId,
      preKeyId,
      signedPreKeyId,
      baseKey,
      identityKey,
      sm
    );
    assert.deepEqual(pkm.preKeyId(), preKeyId);
    assert.deepEqual(pkm.registrationId(), registrationId);
    assert.deepEqual(pkm.signedPreKeyId(), signedPreKeyId);
    assert.deepEqual(pkm.version(), messageVersion);

    const pkm_bytes = pkm.serialize();

    const pkm2 = SignalClient.PreKeySignalMessage.deserialize(pkm_bytes);

    assert.deepEqual(pkm2.serialize(), pkm_bytes);
  });

  for (const testCase of sessionVersionTestCases) {
    describe(`Session ${testCase.suffix}`, () => {
      it('BasicPreKeyMessaging', async () => {
        const aliceStores = new TestStores();
        const bobStores = new TestStores();

        const aAddress = SignalClient.ProtocolAddress.new('+14151111111', 1);
        const bAddress = SignalClient.ProtocolAddress.new('+19192222222', 1);

        const bPreKeyBundle = await testCase.makeBundle(bAddress, bobStores);

        await SignalClient.processPreKeyBundle(
          bPreKeyBundle,
          bAddress,
          aliceStores.session,
          aliceStores.identity
        );
        const aMessage = Buffer.from('Greetings hoo-man', 'utf8');

        const aCiphertext = await SignalClient.signalEncrypt(
          aMessage,
          bAddress,
          aliceStores.session,
          aliceStores.identity
        );

        assert.deepEqual(
          aCiphertext.type(),
          SignalClient.CiphertextMessageType.PreKey
        );

        const aCiphertextR = SignalClient.PreKeySignalMessage.deserialize(
          aCiphertext.serialize()
        );

        const bDPlaintext = await SignalClient.signalDecryptPreKey(
          aCiphertextR,
          aAddress,
          bobStores.session,
          bobStores.identity,
          bobStores.prekey,
          bobStores.signed,
          bobStores.kyber
        );
        assert.deepEqual(bDPlaintext, aMessage);

        const bMessage = Buffer.from(
          'Sometimes the only thing more dangerous than a question is an answer.',
          'utf8'
        );

        const bCiphertext = await SignalClient.signalEncrypt(
          bMessage,
          aAddress,
          bobStores.session,
          bobStores.identity
        );

        assert.deepEqual(
          bCiphertext.type(),
          SignalClient.CiphertextMessageType.Whisper
        );

        const bCiphertextR = SignalClient.SignalMessage.deserialize(
          bCiphertext.serialize()
        );

        const aDPlaintext = await SignalClient.signalDecrypt(
          bCiphertextR,
          bAddress,
          aliceStores.session,
          aliceStores.identity
        );

        assert.deepEqual(aDPlaintext, bMessage);

        const session = await bobStores.session.getSession(aAddress);
        assert(session !== null);

        assert(session.serialize().length > 0);
        assert.deepEqual(session.localRegistrationId(), 5);
        assert.deepEqual(session.remoteRegistrationId(), 5);
        assert(session.hasCurrentState());
        assert(
          !session.currentRatchetKeyMatches(
            SignalClient.PrivateKey.generate().getPublicKey()
          )
        );

        session.archiveCurrentState();
        assert(!session.hasCurrentState());
        assert(
          !session.currentRatchetKeyMatches(
            SignalClient.PrivateKey.generate().getPublicKey()
          )
        );
      });

      it('handles duplicated messages', async () => {
        const aliceStores = new TestStores();
        const bobStores = new TestStores();

        const aAddress = SignalClient.ProtocolAddress.new('+14151111111', 1);
        const bAddress = SignalClient.ProtocolAddress.new('+19192222222', 1);

        const bPreKeyBundle = await testCase.makeBundle(bAddress, bobStores);

        await SignalClient.processPreKeyBundle(
          bPreKeyBundle,
          bAddress,
          aliceStores.session,
          aliceStores.identity
        );
        const aMessage = Buffer.from('Greetings hoo-man', 'utf8');

        const aCiphertext = await SignalClient.signalEncrypt(
          aMessage,
          bAddress,
          aliceStores.session,
          aliceStores.identity
        );

        assert.deepEqual(
          aCiphertext.type(),
          SignalClient.CiphertextMessageType.PreKey
        );

        const aCiphertextR = SignalClient.PreKeySignalMessage.deserialize(
          aCiphertext.serialize()
        );

        const bDPlaintext = await SignalClient.signalDecryptPreKey(
          aCiphertextR,
          aAddress,
          bobStores.session,
          bobStores.identity,
          bobStores.prekey,
          bobStores.signed,
          bobStores.kyber
        );
        assert.deepEqual(bDPlaintext, aMessage);

        try {
          await SignalClient.signalDecryptPreKey(
            aCiphertextR,
            aAddress,
            bobStores.session,
            bobStores.identity,
            bobStores.prekey,
            bobStores.signed,
            bobStores.kyber
          );
          assert.fail();
        } catch (e) {
          assert.instanceOf(e, Error);
          assert.instanceOf(e, SignalClient.LibSignalErrorBase);
          const err = e as SignalClient.LibSignalError;
          assert.equal(err.name, 'DuplicatedMessage');
          assert.equal(err.code, SignalClient.ErrorCode.DuplicatedMessage);
          assert.equal(
            err.operation,
            'SessionCipher_DecryptPreKeySignalMessage'
          ); // the Rust entry point
          assert.exists(err.stack); // Make sure we're still getting the benefits of Error.
        }

        const bMessage = Buffer.from(
          'Sometimes the only thing more dangerous than a question is an answer.',
          'utf8'
        );

        const bCiphertext = await SignalClient.signalEncrypt(
          bMessage,
          aAddress,
          bobStores.session,
          bobStores.identity
        );

        assert.deepEqual(
          bCiphertext.type(),
          SignalClient.CiphertextMessageType.Whisper
        );

        const bCiphertextR = SignalClient.SignalMessage.deserialize(
          bCiphertext.serialize()
        );

        const aDPlaintext = await SignalClient.signalDecrypt(
          bCiphertextR,
          bAddress,
          aliceStores.session,
          aliceStores.identity
        );

        assert.deepEqual(aDPlaintext, bMessage);

        try {
          await SignalClient.signalDecrypt(
            bCiphertextR,
            bAddress,
            aliceStores.session,
            aliceStores.identity
          );
          assert.fail();
        } catch (e) {
          assert.instanceOf(e, Error);
          assert.instanceOf(e, SignalClient.LibSignalErrorBase);
          const err = e as SignalClient.LibSignalError;
          assert.equal(err.name, 'DuplicatedMessage');
          assert.equal(err.code, SignalClient.ErrorCode.DuplicatedMessage);
          assert.equal(err.operation, 'SessionCipher_DecryptSignalMessage'); // the Rust entry point
          assert.exists(err.stack); // Make sure we're still getting the benefits of Error.
        }
      });

      it('expires unacknowledged sessions', async () => {
        const aliceStores = new TestStores();
        const bobStores = new TestStores();

        const bAddress = SignalClient.ProtocolAddress.new('+19192222222', 1);

        const bPreKeyBundle = await testCase.makeBundle(bAddress, bobStores);

        await SignalClient.processPreKeyBundle(
          bPreKeyBundle,
          bAddress,
          aliceStores.session,
          aliceStores.identity,
          new Date('2020-01-01')
        );

        const initialSession = await aliceStores.session.getSession(bAddress);
        assert.isTrue(initialSession?.hasCurrentState(new Date('2020-01-01')));
        assert.isFalse(initialSession?.hasCurrentState(new Date('2023-01-01')));

        const aMessage = Buffer.from('Greetings hoo-man', 'utf8');
        const aCiphertext = await SignalClient.signalEncrypt(
          aMessage,
          bAddress,
          aliceStores.session,
          aliceStores.identity,
          new Date('2020-01-01')
        );

        assert.deepEqual(
          aCiphertext.type(),
          SignalClient.CiphertextMessageType.PreKey
        );

        const updatedSession = await aliceStores.session.getSession(bAddress);
        assert.isTrue(updatedSession?.hasCurrentState(new Date('2020-01-01')));
        assert.isFalse(updatedSession?.hasCurrentState(new Date('2023-01-01')));

        await assert.isRejected(
          SignalClient.signalEncrypt(
            aMessage,
            bAddress,
            aliceStores.session,
            aliceStores.identity,
            new Date('2023-01-01')
          )
        );
      });
    });
  }

  describe('SealedSender', () => {
    it('can encrypt/decrypt 1-1 messages', async () => {
      const aKeys = new InMemoryIdentityKeyStore();
      const bKeys = new InMemoryIdentityKeyStore();

      const aSess = new InMemorySessionStore();
      const bSess = new InMemorySessionStore();

      const bPreK = new InMemoryPreKeyStore();
      const bSPreK = new InMemorySignedPreKeyStore();
      const bKyberStore = new InMemoryKyberPreKeyStore();

      const bPreKey = SignalClient.PrivateKey.generate();
      const bSPreKey = SignalClient.PrivateKey.generate();

      const aIdentityKey = await aKeys.getIdentityKey();
      const bIdentityKey = await bKeys.getIdentityKey();

      const aE164 = '+14151111111';
      const bE164 = '+19192222222';

      const aDeviceId = 1;
      const bDeviceId = 3;

      const aUuid = '9d0652a3-dcc3-4d11-975f-74d61598733f';
      const bUuid = '796abedb-ca4e-4f18-8803-1fde5b921f9f';

      const trustRoot = SignalClient.PrivateKey.generate();
      const serverKey = SignalClient.PrivateKey.generate();

      const serverCert = SignalClient.ServerCertificate.new(
        1,
        serverKey.getPublicKey(),
        trustRoot
      );

      const expires = 1605722925;
      const senderCert = SignalClient.SenderCertificate.new(
        aUuid,
        aE164,
        aDeviceId,
        aIdentityKey.getPublicKey(),
        expires,
        serverCert,
        serverKey
      );

      const bRegistrationId = await bKeys.getLocalRegistrationId();
      const bPreKeyId = 31337;
      const bSignedPreKeyId = 22;

      const bSignedPreKeySig = bIdentityKey.sign(
        bSPreKey.getPublicKey().serialize()
      );

      const bKyberPrekeyId = 777;
      const bKyberKeyPair = SignalClient.KEMKeyPair.generate();
      const bKyberPrekeySignature = bIdentityKey.sign(
        bKyberKeyPair.getPublicKey().serialize()
      );

      const bPreKeyBundle = SignalClient.PreKeyBundle.new(
        bRegistrationId,
        bDeviceId,
        bPreKeyId,
        bPreKey.getPublicKey(),
        bSignedPreKeyId,
        bSPreKey.getPublicKey(),
        bSignedPreKeySig,
        bIdentityKey.getPublicKey(),
        bKyberPrekeyId,
        bKyberKeyPair.getPublicKey(),
        bKyberPrekeySignature
      );

      const bPreKeyRecord = SignalClient.PreKeyRecord.new(
        bPreKeyId,
        bPreKey.getPublicKey(),
        bPreKey
      );
      await bPreK.savePreKey(bPreKeyId, bPreKeyRecord);

      const bSPreKeyRecord = SignalClient.SignedPreKeyRecord.new(
        bSignedPreKeyId,
        42, // timestamp
        bSPreKey.getPublicKey(),
        bSPreKey,
        bSignedPreKeySig
      );
      await bSPreK.saveSignedPreKey(bSignedPreKeyId, bSPreKeyRecord);

      const bKyberPreKeyRecord = SignalClient.KyberPreKeyRecord.new(
        bKyberPrekeyId,
        42, // timestamp
        bKyberKeyPair,
        bKyberPrekeySignature
      );
      await bKyberStore.saveKyberPreKey(bKyberPrekeyId, bKyberPreKeyRecord);

      const bAddress = SignalClient.ProtocolAddress.new(bUuid, bDeviceId);
      await SignalClient.processPreKeyBundle(
        bPreKeyBundle,
        bAddress,
        aSess,
        aKeys
      );

      const aPlaintext = Buffer.from('hi there', 'utf8');

      const aCiphertext = await SignalClient.sealedSenderEncryptMessage(
        aPlaintext,
        bAddress,
        senderCert,
        aSess,
        aKeys
      );

      const bPlaintext = await SignalClient.sealedSenderDecryptMessage(
        aCiphertext,
        trustRoot.getPublicKey(),
        43, // timestamp,
        bE164,
        bUuid,
        bDeviceId,
        bSess,
        bKeys,
        bPreK,
        bSPreK,
        bKyberStore
      );

      assert(bPlaintext != null);
      assert.deepEqual(bPlaintext.message(), aPlaintext);
      assert.deepEqual(bPlaintext.senderE164(), aE164);
      assert.deepEqual(bPlaintext.senderUuid(), aUuid);
      assert.deepEqual(bPlaintext.senderAci()?.getServiceIdString(), aUuid);
      assert.deepEqual(bPlaintext.deviceId(), aDeviceId);

      const innerMessage = await SignalClient.signalEncrypt(
        aPlaintext,
        bAddress,
        aSess,
        aKeys
      );

      for (const hint of [
        200,
        SignalClient.ContentHint.Default,
        SignalClient.ContentHint.Resendable,
        SignalClient.ContentHint.Implicit,
      ]) {
        const content = SignalClient.UnidentifiedSenderMessageContent.new(
          innerMessage,
          senderCert,
          hint,
          null
        );
        const ciphertext = await SignalClient.sealedSenderEncrypt(
          content,
          bAddress,
          aKeys
        );
        const decryptedContent = await SignalClient.sealedSenderDecryptToUsmc(
          ciphertext,
          bKeys
        );
        assert.deepEqual(decryptedContent.contentHint(), hint);
      }
    });

    it('rejects self-sent messages', async () => {
      const sharedKeys = new InMemoryIdentityKeyStore();

      const aSess = new InMemorySessionStore();
      const bSess = new InMemorySessionStore();

      const bPreK = new InMemoryPreKeyStore();
      const bSPreK = new InMemorySignedPreKeyStore();
      const bKyberStore = new InMemoryKyberPreKeyStore();

      const bPreKey = SignalClient.PrivateKey.generate();
      const bSPreKey = SignalClient.PrivateKey.generate();

      const sharedIdentityKey = await sharedKeys.getIdentityKey();

      const aE164 = '+14151111111';

      const sharedDeviceId = 1;

      const sharedUuid = '9d0652a3-dcc3-4d11-975f-74d61598733f';

      const trustRoot = SignalClient.PrivateKey.generate();
      const serverKey = SignalClient.PrivateKey.generate();

      const serverCert = SignalClient.ServerCertificate.new(
        1,
        serverKey.getPublicKey(),
        trustRoot
      );

      const expires = 1605722925;
      const senderCert = SignalClient.SenderCertificate.new(
        sharedUuid,
        aE164,
        sharedDeviceId,
        sharedIdentityKey.getPublicKey(),
        expires,
        serverCert,
        serverKey
      );

      const sharedRegistrationId = await sharedKeys.getLocalRegistrationId();
      const bPreKeyId = 31337;
      const bSignedPreKeyId = 22;

      const bSignedPreKeySig = sharedIdentityKey.sign(
        bSPreKey.getPublicKey().serialize()
      );

      const bKyberPrekeyId = 777;
      const bKyberKeyPair = SignalClient.KEMKeyPair.generate();
      const bKyberPrekeySignature = sharedIdentityKey.sign(
        bKyberKeyPair.getPublicKey().serialize()
      );

      const bPreKeyBundle = SignalClient.PreKeyBundle.new(
        sharedRegistrationId,
        sharedDeviceId,
        bPreKeyId,
        bPreKey.getPublicKey(),
        bSignedPreKeyId,
        bSPreKey.getPublicKey(),
        bSignedPreKeySig,
        sharedIdentityKey.getPublicKey(),
        bKyberPrekeyId,
        bKyberKeyPair.getPublicKey(),
        bKyberPrekeySignature
      );

      const bPreKeyRecord = SignalClient.PreKeyRecord.new(
        bPreKeyId,
        bPreKey.getPublicKey(),
        bPreKey
      );
      await bPreK.savePreKey(bPreKeyId, bPreKeyRecord);

      const bSPreKeyRecord = SignalClient.SignedPreKeyRecord.new(
        bSignedPreKeyId,
        42, // timestamp
        bSPreKey.getPublicKey(),
        bSPreKey,
        bSignedPreKeySig
      );
      await bSPreK.saveSignedPreKey(bSignedPreKeyId, bSPreKeyRecord);

      const bKyberPreKeyRecord = SignalClient.KyberPreKeyRecord.new(
        bKyberPrekeyId,
        42, // timestamp
        bKyberKeyPair,
        bKyberPrekeySignature
      );
      await bKyberStore.saveKyberPreKey(bKyberPrekeyId, bKyberPreKeyRecord);

      const sharedAddress = SignalClient.ProtocolAddress.new(
        sharedUuid,
        sharedDeviceId
      );
      await SignalClient.processPreKeyBundle(
        bPreKeyBundle,
        sharedAddress,
        aSess,
        sharedKeys
      );

      const aPlaintext = Buffer.from('hi there', 'utf8');

      const aCiphertext = await SignalClient.sealedSenderEncryptMessage(
        aPlaintext,
        sharedAddress,
        senderCert,
        aSess,
        sharedKeys
      );

      try {
        await SignalClient.sealedSenderDecryptMessage(
          aCiphertext,
          trustRoot.getPublicKey(),
          43, // timestamp,
          null,
          sharedUuid,
          sharedDeviceId,
          bSess,
          sharedKeys,
          bPreK,
          bSPreK,
          bKyberStore
        );
        assert.fail();
      } catch (e) {
        assert.instanceOf(e, Error);
        assert.instanceOf(e, SignalClient.LibSignalErrorBase);
        const err = e as SignalClient.LibSignalError;
        assert.equal(err.name, 'SealedSenderSelfSend');
        assert.equal(err.code, SignalClient.ErrorCode.SealedSenderSelfSend);
        assert.equal(err.operation, 'SealedSender_DecryptMessage'); // the Rust entry point
        assert.exists(err.stack); // Make sure we're still getting the benefits of Error.
      }
    });

    it('can encrypt/decrypt group messages', async () => {
      const aKeys = new InMemoryIdentityKeyStore();
      const bKeys = new InMemoryIdentityKeyStore();

      const aSess = new InMemorySessionStore();

      const bPreK = new InMemoryPreKeyStore();
      const bSPreK = new InMemorySignedPreKeyStore();
      const bKyberStore = new InMemoryKyberPreKeyStore();

      const bPreKey = SignalClient.PrivateKey.generate();
      const bSPreKey = SignalClient.PrivateKey.generate();

      const aIdentityKey = await aKeys.getIdentityKey();
      const bIdentityKey = await bKeys.getIdentityKey();

      const aE164 = '+14151111111';

      const aDeviceId = 1;
      const bDeviceId = 3;

      const aUuid = '9d0652a3-dcc3-4d11-975f-74d61598733f';
      const bUuid = '796abedb-ca4e-4f18-8803-1fde5b921f9f';

      const trustRoot = SignalClient.PrivateKey.generate();
      const serverKey = SignalClient.PrivateKey.generate();

      const serverCert = SignalClient.ServerCertificate.new(
        1,
        serverKey.getPublicKey(),
        trustRoot
      );

      const expires = 1605722925;
      const senderCert = SignalClient.SenderCertificate.new(
        aUuid,
        aE164,
        aDeviceId,
        aIdentityKey.getPublicKey(),
        expires,
        serverCert,
        serverKey
      );

      const bRegistrationId = await bKeys.getLocalRegistrationId();
      const bPreKeyId = 31337;
      const bSignedPreKeyId = 22;

      const bSignedPreKeySig = bIdentityKey.sign(
        bSPreKey.getPublicKey().serialize()
      );

      const bKyberPrekeyId = 777;
      const bKyberKeyPair = SignalClient.KEMKeyPair.generate();
      const bKyberPrekeySignature = bIdentityKey.sign(
        bKyberKeyPair.getPublicKey().serialize()
      );

      const bPreKeyBundle = SignalClient.PreKeyBundle.new(
        bRegistrationId,
        bDeviceId,
        bPreKeyId,
        bPreKey.getPublicKey(),
        bSignedPreKeyId,
        bSPreKey.getPublicKey(),
        bSignedPreKeySig,
        bIdentityKey.getPublicKey(),
        bKyberPrekeyId,
        bKyberKeyPair.getPublicKey(),
        bKyberPrekeySignature
      );

      const bPreKeyRecord = SignalClient.PreKeyRecord.new(
        bPreKeyId,
        bPreKey.getPublicKey(),
        bPreKey
      );
      await bPreK.savePreKey(bPreKeyId, bPreKeyRecord);

      const bSPreKeyRecord = SignalClient.SignedPreKeyRecord.new(
        bSignedPreKeyId,
        42, // timestamp
        bSPreKey.getPublicKey(),
        bSPreKey,
        bSignedPreKeySig
      );
      await bSPreK.saveSignedPreKey(bSignedPreKeyId, bSPreKeyRecord);

      const bKyberPreKeyRecord = SignalClient.KyberPreKeyRecord.new(
        bKyberPrekeyId,
        42, // timestamp
        bKyberKeyPair,
        bKyberPrekeySignature
      );
      await bKyberStore.saveKyberPreKey(bKyberPrekeyId, bKyberPreKeyRecord);

      const bAddress = SignalClient.ProtocolAddress.new(bUuid, bDeviceId);
      await SignalClient.processPreKeyBundle(
        bPreKeyBundle,
        bAddress,
        aSess,
        aKeys
      );

      const aAddress = SignalClient.ProtocolAddress.new(aUuid, aDeviceId);

      const distributionId = 'd1d1d1d1-7000-11eb-b32a-33b8a8a487a6';
      const aSenderKeyStore = new InMemorySenderKeyStore();
      const skdm = await SignalClient.SenderKeyDistributionMessage.create(
        aAddress,
        distributionId,
        aSenderKeyStore
      );

      const bSenderKeyStore = new InMemorySenderKeyStore();
      await SignalClient.processSenderKeyDistributionMessage(
        aAddress,
        skdm,
        bSenderKeyStore
      );

      const message = Buffer.from('0a0b0c', 'hex');

      const aCtext = await SignalClient.groupEncrypt(
        aAddress,
        distributionId,
        aSenderKeyStore,
        message
      );

      const aUsmc = SignalClient.UnidentifiedSenderMessageContent.new(
        aCtext,
        senderCert,
        SignalClient.ContentHint.Implicit,
        Buffer.from([42])
      );

      const aSealedSenderMessage =
        await SignalClient.sealedSenderMultiRecipientEncrypt(
          aUsmc,
          [bAddress],
          aKeys,
          aSess
        );

      const bSealedSenderMessage =
        SignalClient.sealedSenderMultiRecipientMessageForSingleRecipient(
          aSealedSenderMessage
        );

      const bUsmc = await SignalClient.sealedSenderDecryptToUsmc(
        bSealedSenderMessage,
        bKeys
      );

      assert.deepEqual(bUsmc.senderCertificate().senderE164(), aE164);
      assert.deepEqual(bUsmc.senderCertificate().senderUuid(), aUuid);
      assert.deepEqual(bUsmc.senderCertificate().senderDeviceId(), aDeviceId);
      assert.deepEqual(bUsmc.contentHint(), SignalClient.ContentHint.Implicit);
      assert.deepEqual(bUsmc.groupId(), Buffer.from([42]));

      const bPtext = await SignalClient.groupDecrypt(
        aAddress,
        bSenderKeyStore,
        bUsmc.contents()
      );

      assert.deepEqual(message, bPtext);

      // Make sure the option-based syntax does the same thing.
      const aSealedSenderMessageViaOptions =
        await SignalClient.sealedSenderMultiRecipientEncrypt({
          content: aUsmc,
          recipients: [bAddress],
          identityStore: aKeys,
          sessionStore: aSess,
        });

      const bSealedSenderMessageViaOptions =
        SignalClient.sealedSenderMultiRecipientMessageForSingleRecipient(
          aSealedSenderMessageViaOptions
        );

      const bUsmcViaOptions = await SignalClient.sealedSenderDecryptToUsmc(
        bSealedSenderMessageViaOptions,
        bKeys
      );

      assert.deepEqual(bUsmcViaOptions, bUsmc);
    });

    it('rejects invalid registration IDs', async () => {
      const aKeys = new InMemoryIdentityKeyStore();
      const bKeys = new InMemoryIdentityKeyStore(0x4000);

      const aSess = new InMemorySessionStore();

      const bPreKey = SignalClient.PrivateKey.generate();
      const bSPreKey = SignalClient.PrivateKey.generate();

      const aIdentityKey = await aKeys.getIdentityKey();
      const bIdentityKey = await bKeys.getIdentityKey();

      const aE164 = '+14151111111';

      const aDeviceId = 1;
      const bDeviceId = 3;

      const aUuid = '9d0652a3-dcc3-4d11-975f-74d61598733f';
      const bUuid = '796abedb-ca4e-4f18-8803-1fde5b921f9f';

      const trustRoot = SignalClient.PrivateKey.generate();
      const serverKey = SignalClient.PrivateKey.generate();

      const serverCert = SignalClient.ServerCertificate.new(
        1,
        serverKey.getPublicKey(),
        trustRoot
      );

      const expires = 1605722925;
      const senderCert = SignalClient.SenderCertificate.new(
        aUuid,
        aE164,
        aDeviceId,
        aIdentityKey.getPublicKey(),
        expires,
        serverCert,
        serverKey
      );

      const bPreKeyId = 31337;
      const bSignedPreKeyId = 22;

      const bSignedPreKeySig = bIdentityKey.sign(
        bSPreKey.getPublicKey().serialize()
      );

      const bKyberPrekeyId = 777;
      const bKyberKeyPair = SignalClient.KEMKeyPair.generate();
      const bKyberPrekeySignature = bIdentityKey.sign(
        bKyberKeyPair.getPublicKey().serialize()
      );

      const bPreKeyBundle = SignalClient.PreKeyBundle.new(
        0x4000,
        bDeviceId,
        bPreKeyId,
        bPreKey.getPublicKey(),
        bSignedPreKeyId,
        bSPreKey.getPublicKey(),
        bSignedPreKeySig,
        bIdentityKey.getPublicKey(),
        bKyberPrekeyId,
        bKyberKeyPair.getPublicKey(),
        bKyberPrekeySignature
      );

      const bAddress = SignalClient.ProtocolAddress.new(bUuid, bDeviceId);
      await SignalClient.processPreKeyBundle(
        bPreKeyBundle,
        bAddress,
        aSess,
        aKeys
      );

      const aAddress = SignalClient.ProtocolAddress.new(aUuid, aDeviceId);

      const distributionId = 'd1d1d1d1-7000-11eb-b32a-33b8a8a487a6';
      const aSenderKeyStore = new InMemorySenderKeyStore();
      await SignalClient.SenderKeyDistributionMessage.create(
        aAddress,
        distributionId,
        aSenderKeyStore
      );

      const message = Buffer.from('0a0b0c', 'hex');

      const aCtext = await SignalClient.groupEncrypt(
        aAddress,
        distributionId,
        aSenderKeyStore,
        message
      );

      const aUsmc = SignalClient.UnidentifiedSenderMessageContent.new(
        aCtext,
        senderCert,
        SignalClient.ContentHint.Implicit,
        Buffer.from([42])
      );

      try {
        await SignalClient.sealedSenderMultiRecipientEncrypt(
          aUsmc,
          [bAddress],
          aKeys,
          aSess
        );
        assert.fail('should have thrown');
      } catch (e) {
        assert.instanceOf(e, Error);
        assert.instanceOf(e, SignalClient.LibSignalErrorBase);
        const err = e as SignalClient.LibSignalError;
        assert.equal(err.name, 'InvalidRegistrationId');
        assert.equal(err.code, SignalClient.ErrorCode.InvalidRegistrationId);
        assert.exists(err.stack); // Make sure we're still getting the benefits of Error.

        // Note: This is not a Chai assert; Chai doesn't yet support TypeScript assert functions for
        // type narrowing. But we already checked the code above.
        assert(err.is(SignalClient.ErrorCode.InvalidRegistrationId));
        assert.equal(err.addr.name(), bAddress.name());
        assert.equal(err.addr.deviceId(), bAddress.deviceId());

        // We can also narrow directly from the original thrown value. (But we didn't do that
        // earlier because we wanted to check all the properties individually.)
        assert(
          SignalClient.LibSignalErrorBase.is(
            e,
            SignalClient.ErrorCode.InvalidRegistrationId
          )
        );
        assert.equal(e.addr.name(), bAddress.name());
      }
    });

    it('can have excluded recipients', async () => {
      const aKeys = new InMemoryIdentityKeyStore();
      const bKeys = new InMemoryIdentityKeyStore(0x4000);

      const aSess = new InMemorySessionStore();

      const bPreKey = SignalClient.PrivateKey.generate();
      const bSPreKey = SignalClient.PrivateKey.generate();

      const aIdentityKey = await aKeys.getIdentityKey();
      const bIdentityKey = await bKeys.getIdentityKey();

      const aE164 = '+14151111111';

      const aDeviceId = 1;
      const bDeviceId = 3;

      const aUuid = '9d0652a3-dcc3-4d11-975f-74d61598733f';
      const bUuid = '796abedb-ca4e-4f18-8803-1fde5b921f9f';
      const eUuid = '3f0f4734-e331-4434-bd4f-6d8f6ea6dcc7';
      const mUuid = '5d088142-6fd7-4dbd-af00-fdda1b3ce988';

      const trustRoot = SignalClient.PrivateKey.generate();
      const serverKey = SignalClient.PrivateKey.generate();

      const serverCert = SignalClient.ServerCertificate.new(
        1,
        serverKey.getPublicKey(),
        trustRoot
      );

      const expires = 1605722925;
      const senderCert = SignalClient.SenderCertificate.new(
        aUuid,
        aE164,
        aDeviceId,
        aIdentityKey.getPublicKey(),
        expires,
        serverCert,
        serverKey
      );

      const bPreKeyId = 31337;
      const bSignedPreKeyId = 22;

      const bSignedPreKeySig = bIdentityKey.sign(
        bSPreKey.getPublicKey().serialize()
      );

      const bKyberPrekeyId = 777;
      const bKyberKeyPair = SignalClient.KEMKeyPair.generate();
      const bKyberPrekeySignature = bIdentityKey.sign(
        bKyberKeyPair.getPublicKey().serialize()
      );

      const bPreKeyBundle = SignalClient.PreKeyBundle.new(
        0x2000,
        bDeviceId,
        bPreKeyId,
        bPreKey.getPublicKey(),
        bSignedPreKeyId,
        bSPreKey.getPublicKey(),
        bSignedPreKeySig,
        bIdentityKey.getPublicKey(),
        bKyberPrekeyId,
        bKyberKeyPair.getPublicKey(),
        bKyberPrekeySignature
      );

      const bAddress = SignalClient.ProtocolAddress.new(bUuid, bDeviceId);
      await SignalClient.processPreKeyBundle(
        bPreKeyBundle,
        bAddress,
        aSess,
        aKeys
      );

      const aAddress = SignalClient.ProtocolAddress.new(aUuid, aDeviceId);

      const distributionId = 'd1d1d1d1-7000-11eb-b32a-33b8a8a487a6';
      const aSenderKeyStore = new InMemorySenderKeyStore();
      await SignalClient.SenderKeyDistributionMessage.create(
        aAddress,
        distributionId,
        aSenderKeyStore
      );

      const message = Buffer.from('0a0b0c', 'hex');

      const aCtext = await SignalClient.groupEncrypt(
        aAddress,
        distributionId,
        aSenderKeyStore,
        message
      );

      const aUsmc = SignalClient.UnidentifiedSenderMessageContent.new(
        aCtext,
        senderCert,
        SignalClient.ContentHint.Implicit,
        Buffer.from([42])
      );

      const aSentMessage = await SignalClient.sealedSenderMultiRecipientEncrypt(
        {
          content: aUsmc,
          recipients: [bAddress],
          excludedRecipients: [
            SignalClient.ServiceId.parseFromServiceIdString(eUuid),
            SignalClient.ServiceId.parseFromServiceIdString(mUuid),
          ],
          identityStore: aKeys,
          sessionStore: aSess,
        }
      );

      // Clients can't directly parse arbitrary SSv2 SentMessages, so just check that it contains
      // the excluded recipient service IDs followed by a device ID of 0.
      const hexEncodedSentMessage = aSentMessage.toString('hex');

      const indexOfE = hexEncodedSentMessage.indexOf(
        SignalClient.ServiceId.parseFromServiceIdString(eUuid)
          .getServiceIdFixedWidthBinary()
          .toString('hex')
      );
      assert.notEqual(indexOfE, -1);
      assert.equal(aSentMessage[indexOfE / 2 + 17], 0);

      const indexOfM = hexEncodedSentMessage.indexOf(
        SignalClient.ServiceId.parseFromServiceIdString(mUuid)
          .getServiceIdFixedWidthBinary()
          .toString('hex')
      );
      assert.notEqual(indexOfM, -1);
      assert.equal(aSentMessage[indexOfM / 2 + 17], 0);
    });
  });

  it('DecryptionErrorMessage', async () => {
    const aKeys = new InMemoryIdentityKeyStore();
    const bKeys = new InMemoryIdentityKeyStore();

    const aSess = new InMemorySessionStore();
    const bSess = new InMemorySessionStore();

    const bPreK = new InMemoryPreKeyStore();
    const bSPreK = new InMemorySignedPreKeyStore();
    const bKyberStore = new InMemoryKyberPreKeyStore();

    const bPreKey = SignalClient.PrivateKey.generate();
    const bSPreKey = SignalClient.PrivateKey.generate();

    const aIdentityKey = await aKeys.getIdentityKey();
    const bIdentityKey = await bKeys.getIdentityKey();

    const aE164 = '+14151111111';

    const aDeviceId = 1;
    const bDeviceId = 3;

    const aUuid = '9d0652a3-dcc3-4d11-975f-74d61598733f';
    const bUuid = '796abedb-ca4e-4f18-8803-1fde5b921f9f';

    const trustRoot = SignalClient.PrivateKey.generate();
    const serverKey = SignalClient.PrivateKey.generate();

    const serverCert = SignalClient.ServerCertificate.new(
      1,
      serverKey.getPublicKey(),
      trustRoot
    );

    const expires = 1605722925;
    const senderCert = SignalClient.SenderCertificate.new(
      aUuid,
      aE164,
      aDeviceId,
      aIdentityKey.getPublicKey(),
      expires,
      serverCert,
      serverKey
    );

    const bRegistrationId = await bKeys.getLocalRegistrationId();
    const bPreKeyId = 31337;
    const bSignedPreKeyId = 22;

    const bSignedPreKeySig = bIdentityKey.sign(
      bSPreKey.getPublicKey().serialize()
    );

    const bKyberPrekeyId = 777;
    const bKyberKeyPair = SignalClient.KEMKeyPair.generate();
    const bKyberPrekeySignature = bIdentityKey.sign(
      bKyberKeyPair.getPublicKey().serialize()
    );

    const bPreKeyBundle = SignalClient.PreKeyBundle.new(
      bRegistrationId,
      bDeviceId,
      bPreKeyId,
      bPreKey.getPublicKey(),
      bSignedPreKeyId,
      bSPreKey.getPublicKey(),
      bSignedPreKeySig,
      bIdentityKey.getPublicKey(),
      bKyberPrekeyId,
      bKyberKeyPair.getPublicKey(),
      bKyberPrekeySignature
    );

    const bPreKeyRecord = SignalClient.PreKeyRecord.new(
      bPreKeyId,
      bPreKey.getPublicKey(),
      bPreKey
    );
    await bPreK.savePreKey(bPreKeyId, bPreKeyRecord);

    const bSPreKeyRecord = SignalClient.SignedPreKeyRecord.new(
      bSignedPreKeyId,
      42, // timestamp
      bSPreKey.getPublicKey(),
      bSPreKey,
      bSignedPreKeySig
    );
    await bSPreK.saveSignedPreKey(bSignedPreKeyId, bSPreKeyRecord);

    const bKyberPreKeyRecord = SignalClient.KyberPreKeyRecord.new(
      bKyberPrekeyId,
      42, // timestamp
      bKyberKeyPair,
      bKyberPrekeySignature
    );
    await bKyberStore.saveKyberPreKey(bKyberPrekeyId, bKyberPreKeyRecord);

    // Set up the session with a message from A to B.

    const bAddress = SignalClient.ProtocolAddress.new(bUuid, bDeviceId);
    await SignalClient.processPreKeyBundle(
      bPreKeyBundle,
      bAddress,
      aSess,
      aKeys
    );

    const aPlaintext = Buffer.from('hi there', 'utf8');

    const aCiphertext = await SignalClient.sealedSenderEncryptMessage(
      aPlaintext,
      bAddress,
      senderCert,
      aSess,
      aKeys
    );

    await SignalClient.sealedSenderDecryptMessage(
      aCiphertext,
      trustRoot.getPublicKey(),
      43, // timestamp,
      null,
      bUuid,
      bDeviceId,
      bSess,
      bKeys,
      bPreK,
      bSPreK,
      bKyberStore
    );

    // Pretend to send a message from B back to A that "fails".
    const aAddress = SignalClient.ProtocolAddress.new(aUuid, aDeviceId);
    const bCiphertext = await SignalClient.signalEncrypt(
      Buffer.from('reply', 'utf8'),
      aAddress,
      bSess,
      bKeys
    );

    const errorMessage = SignalClient.DecryptionErrorMessage.forOriginal(
      bCiphertext.serialize(),
      bCiphertext.type(),
      45, // timestamp
      bAddress.deviceId()
    );
    const errorContent = SignalClient.PlaintextContent.from(errorMessage);
    const errorUSMC = SignalClient.UnidentifiedSenderMessageContent.new(
      SignalClient.CiphertextMessage.from(errorContent),
      senderCert,
      SignalClient.ContentHint.Implicit,
      null // group ID
    );
    const errorSealedSenderMessage = await SignalClient.sealedSenderEncrypt(
      errorUSMC,
      bAddress,
      aKeys
    );

    const bErrorUSMC = await SignalClient.sealedSenderDecryptToUsmc(
      errorSealedSenderMessage,
      bKeys
    );
    assert.equal(
      bErrorUSMC.msgType(),
      SignalClient.CiphertextMessageType.Plaintext
    );
    const bErrorContent = SignalClient.PlaintextContent.deserialize(
      bErrorUSMC.contents()
    );
    const bErrorMessage =
      SignalClient.DecryptionErrorMessage.extractFromSerializedBody(
        bErrorContent.body()
      );
    assert.equal(bErrorMessage.timestamp(), 45);
    assert.equal(bErrorMessage.deviceId(), bAddress.deviceId());

    const bSessionWithA = await bSess.getSession(aAddress);
    assert(
      bSessionWithA?.currentRatchetKeyMatches(
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        bErrorMessage.ratchetKey()!
      )
    );
  });

  it('AES-GCM-SIV test vector', () => {
    // RFC 8452, appendix C.2
    const key = Buffer.from(
      '0100000000000000000000000000000000000000000000000000000000000000',
      'hex'
    );

    const aes_gcm_siv = SignalClient.Aes256GcmSiv.new(key);

    const nonce = Buffer.from('030000000000000000000000', 'hex');
    const aad = Buffer.from('010000000000000000000000', 'hex');
    const ptext = Buffer.from('02000000', 'hex');

    const ctext = aes_gcm_siv.encrypt(ptext, nonce, aad);

    assert.deepEqual(
      ctext.toString('hex'),
      '22b3f4cd1835e517741dfddccfa07fa4661b74cf'
    );

    const decrypted = aes_gcm_siv.decrypt(ctext, nonce, aad);

    assert.deepEqual(decrypted.toString('hex'), '02000000');
  });
  it('ECC signatures work', () => {
    const priv_a = SignalClient.PrivateKey.generate();
    const priv_b = SignalClient.PrivateKey.generate();
    assert.lengthOf(priv_a.serialize(), 32, 'private key serialization length');
    assert.deepEqual(priv_a.serialize(), priv_a.serialize(), 'repeatable');
    assert.notDeepEqual(
      priv_a.serialize(),
      priv_b.serialize(),
      'different for different keys'
    );

    const pub_a = priv_a.getPublicKey();
    const pub_b = priv_b.getPublicKey();

    const msg = Buffer.from([1, 2, 3]);

    const sig_a = priv_a.sign(msg);
    assert.lengthOf(sig_a, 64, 'signature length');

    assert(pub_a.verify(msg, sig_a));
    assert(!pub_b.verify(msg, sig_a));

    const sig_b = priv_b.sign(msg);
    assert.lengthOf(sig_b, 64, 'signature length');

    assert(pub_b.verify(msg, sig_b));
    assert(!pub_a.verify(msg, sig_b));
  });

  it('ECC key agreement work', () => {
    const priv_a = SignalClient.PrivateKey.generate();
    const priv_b = SignalClient.PrivateKey.generate();

    const pub_a = priv_a.getPublicKey();
    const pub_b = priv_b.getPublicKey();

    const shared_a = priv_a.agree(pub_b);
    const shared_b = priv_b.agree(pub_a);

    assert.deepEqual(shared_a, shared_b, 'key agreement works');
  });

  it('ECC keys roundtrip through serialization', () => {
    const key = Buffer.alloc(32, 0x40);
    const priv = SignalClient.PrivateKey.deserialize(key);
    assert(key.equals(priv.serialize()));

    const pub = priv.getPublicKey();
    const pub_bytes = pub.serialize();
    assert.lengthOf(pub_bytes, 32 + 1);

    const pub2 = SignalClient.PublicKey.deserialize(pub_bytes);

    assert.deepEqual(pub.serialize(), pub2.serialize());

    assert.deepEqual(pub.compare(pub2), 0);
    assert.deepEqual(pub2.compare(pub), 0);

    const anotherKey = SignalClient.PrivateKey.deserialize(
      Buffer.alloc(32, 0xcd)
    ).getPublicKey();
    assert.deepEqual(pub.compare(anotherKey), 1);
    assert.deepEqual(anotherKey.compare(pub), -1);

    assert.lengthOf(pub.getPublicKeyBytes(), 32);

    const keyPair = new SignalClient.IdentityKeyPair(pub, priv);
    const keyPairBytes = keyPair.serialize();
    const roundTripKeyPair =
      SignalClient.IdentityKeyPair.deserialize(keyPairBytes);
    assert.equal(roundTripKeyPair.publicKey.compare(pub), 0);
    const roundTripKeyPairBytes = roundTripKeyPair.serialize();
    assert.deepEqual(keyPairBytes, roundTripKeyPairBytes);
  });

  it('decoding invalid ECC key throws an error', () => {
    const invalid_key = Buffer.alloc(33, 0xab);

    assert.throws(() => {
      SignalClient.PrivateKey.deserialize(invalid_key);
    }, 'bad key length <33> for key with type <Djb>');

    assert.throws(() => {
      SignalClient.PublicKey.deserialize(invalid_key);
    }, 'bad key type <0xab>');
  });

  it('can sign and verify alternate identity keys', () => {
    const primary = SignalClient.IdentityKeyPair.generate();
    const secondary = SignalClient.IdentityKeyPair.generate();
    const signature = secondary.signAlternateIdentity(primary.publicKey);
    assert(
      secondary.publicKey.verifyAlternateIdentity(primary.publicKey, signature)
    );
  });

  it('includes all error codes in LibSignalError', () => {
    // This is a compilation test only.
    type MissingCodes = Exclude<
      SignalClient.ErrorCode,
      SignalClient.LibSignalError['code']
    >;
    function _check(
      hasMissingCode: MissingCodes extends never ? never : unknown
    ): MissingCodes {
      // If the following line errors with something like...
      //
      //     Type 'unknown' is not assignable to type 'ErrorCode.RateLimitedError | ErrorCode.BackupValidation'.
      //
      // ...that means `MissingCode extends never` was false, i.e. there were codes missing from the
      // LibSignalError union. Fortunately, the error message also tells you what they are.
      // (We ought to have been able to write this as `const missing: never = someMissingCodesValue`
      // or similar, but TypeScript 5.3 doesn't show the missing cases in the diagnostic that way.)
      return hasMissingCode;
    }
  });
});
