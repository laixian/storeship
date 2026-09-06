import CoreGraphics
import Foundation

func post(_ type: CGEventType, _ p: CGPoint) {
  CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: p, mouseButton: .left)?
    .post(tap: .cghidEventTap)
}
let a = CommandLine.arguments
func pt(_ i: Int) -> CGPoint { CGPoint(x: Double(a[i])!, y: Double(a[i + 1])!) }

switch a[1] {
case "click":
  let p = pt(2)
  post(.mouseMoved, p); usleep(60_000)
  post(.leftMouseDown, p); usleep(90_000)
  post(.leftMouseUp, p)
case "drag":
  let s = pt(2), e = pt(4)
  let steps = 18
  post(.mouseMoved, s); usleep(60_000)
  post(.leftMouseDown, s); usleep(120_000)
  for i in 1...steps {
    let t = Double(i) / Double(steps)
    post(.leftMouseDragged, CGPoint(x: s.x + (e.x - s.x) * t, y: s.y + (e.y - s.y) * t))
    usleep(18_000)
  }
  usleep(80_000)
  post(.leftMouseUp, e)
default: FileHandle.standardError.write("usage: hid click x y | drag x1 y1 x2 y2\n".data(using: .utf8)!)
}
