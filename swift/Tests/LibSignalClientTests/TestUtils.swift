//
// Copyright 2020-2021 Signal Messenger, LLC.
// SPDX-License-Identifier: AGPL-3.0-only
//

import XCTest

@testable import LibSignalClient

class BadStore: InMemorySignalProtocolStore {
    enum Error: Swift.Error {
        case badness
    }

    override func loadPreKey(id: UInt32, context: StoreContext) throws -> PreKeyRecord {
        throw Error.badness
    }
}

// Wrapped here so that the test files don't need to use @testable import.
func sealedSenderMultiRecipientMessageForSingleRecipient(_ message: Data) throws -> Data {
    return try LibSignalClient.sealedSenderMultiRecipientMessageForSingleRecipient(message)
}

/// Always throws a ``XCTSkip`` error.
///
/// Add this to the top of a test case to make sure it compiles but never runs.
func throwSkipForCompileOnlyTest() throws {
    throw XCTSkip("compilation-only test")
}

func randomBytes(_ count: Int) -> [UInt8] {
    var key = Array(repeating: UInt8(0), count: count)
    key.withUnsafeMutableBytes {
        try! fillRandom($0)
    }
    return key
}

extension Sequence where Element == UInt8 {
    internal var hexString: String {
        Array(self).toHex()
    }
}

extension RangeReplaceableCollection where Element == UInt8 {
    internal init?(fromHexString hex: String) {
        guard hex.count % 2 == 0 else {
            return nil
        }
        self.init()
        var from = hex.startIndex
        while from < hex.endIndex {
            let to = hex.index(from, offsetBy: 2)
            guard let byte = UInt8(hex[from..<to], radix: 16) else {
                return nil
            }
            self.append(byte)
            from = to
        }
    }
}

// Helper for async error assertions until XCTest supports async autoclosures
// Adapted from https://arturgruchala.com/testing-async-await-exceptions/
func assertThrowsErrorAsync<T>(
    _ expression: () async throws -> T,
    _ message: @autoclosure () -> String = "",
    file: StaticString = #filePath,
    line: UInt = #line,
    errorHandler: (Error) -> Void = { _ in }
) async {
    do {
        _ = try await expression()
        XCTFail(message().isEmpty ? "Expected error to be thrown" : message(), file: file, line: line)
    } catch {
        errorHandler(error)
    }
}

final class HexTests: XCTestCase {
    func testToHex() throws {
        XCTAssertEqual("", [].hexString)
        XCTAssertEqual("010aff", [0x01, 0x0A, 0xFF].hexString)
    }

    func testFromHex() throws {
        XCTAssertEqual([0x01, 0x0A, 0xFF], [UInt8](fromHexString: "010aff"))
        XCTAssertEqual([0x01, 0x0A, 0xFF], [UInt8](fromHexString: "010AfF"))
        XCTAssertNil([UInt8](fromHexString: "nonhex"))
        XCTAssertNil([UInt8](fromHexString: "abc"))
    }

    func testRandomBytes() throws {
        for _ in 0..<100 {
            // only generate even lengths
            let count = Int.random(in: 0..<100) / 2 * 2
            let bytes = randomBytes(count)
            XCTAssertEqual(bytes, [UInt8](fromHexString: bytes.hexString), "Failed value: \(bytes)")
        }
    }
}
