import ApplicationServices
import CoreGraphics
import Foundation

struct CursorCommand: Decodable {
    let id: Int?
    let command: String
    let x: Double?
    let y: Double?
    let displayId: Int64?
}

private let decoder = JSONDecoder()

func writeResponse(id: Int?, payload: [String: Any]) {
    guard let id else { return }
    var response = payload
    response["id"] = id
    guard let data = try? JSONSerialization.data(withJSONObject: response),
          var line = String(data: data, encoding: .utf8) else {
        return
    }
    line.append("\n")
    FileHandle.standardOutput.write(Data(line.utf8))
}

func accessibilityTrusted(prompt: Bool) -> Bool {
    if prompt {
        let key = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
        return AXIsProcessTrustedWithOptions([key: true] as CFDictionary)
    }
    return AXIsProcessTrusted()
}

func moveCursor(x: Double, y: Double) {
    guard x.isFinite, y.isFinite, accessibilityTrusted(prompt: false) else { return }
    let point = CGPoint(x: x, y: y)
    CGWarpMouseCursorPosition(point)

    if let event = CGEvent(
        mouseEventSource: nil,
        mouseType: .mouseMoved,
        mouseCursorPosition: point,
        mouseButton: .left
    ) {
        event.post(tap: .cghidEventTap)
    }
}

func moveNormalizedCursor(x: Double, y: Double, displayId: Int64) {
    guard x.isFinite, y.isFinite, accessibilityTrusted(prompt: false) else { return }
    let normalizedX = min(max(x, 0), 1)
    let normalizedY = min(max(y, 0), 1)
    let directDisplayId = CGDirectDisplayID(UInt32(truncatingIfNeeded: displayId))
    let bounds = CGDisplayBounds(directDisplayId)
    guard !bounds.isNull, bounds.width > 0, bounds.height > 0 else { return }
    moveCursor(
        x: bounds.origin.x + normalizedX * bounds.width,
        y: bounds.origin.y + normalizedY * bounds.height
    )
}

while let line = readLine() {
    guard let data = line.data(using: .utf8),
          let command = try? decoder.decode(CursorCommand.self, from: data) else {
        continue
    }

    switch command.command {
    case "status":
        writeResponse(id: command.id, payload: [
            "trusted": accessibilityTrusted(prompt: false),
            "ok": true
        ])
    case "prompt":
        writeResponse(id: command.id, payload: [
            "trusted": accessibilityTrusted(prompt: true),
            "ok": true
        ])
    case "move":
        if let x = command.x, let y = command.y {
            moveCursor(x: x, y: y)
        }
    case "moveNormalized":
        if let x = command.x, let y = command.y, let displayId = command.displayId {
            moveNormalizedCursor(x: x, y: y, displayId: displayId)
        }
    case "quit":
        writeResponse(id: command.id, payload: ["ok": true])
        exit(EXIT_SUCCESS)
    default:
        writeResponse(id: command.id, payload: [
            "ok": false,
            "error": "Unknown command"
        ])
    }
}
