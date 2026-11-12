// Independent X12 check with StAEDI (io.xlate:staedi). Prints one JSON line per interchange file.
// Usage: java -cp staedi.jar:validator Validate <schemaDir> <file>...
import io.xlate.edi.stream.*;
import io.xlate.edi.schema.*;
import java.io.*;
import java.nio.file.*;
import java.util.*;

public class Validate {
  static String esc(String s) { return s == null ? "" : s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", " "); }
  public static void main(String[] a) throws Exception {
    Path schemaDir = Paths.get(a[0]);
    Map<String, Schema> cache = new HashMap<>();
    SchemaFactory sf = SchemaFactory.newFactory();
    EDIInputFactory f = EDIInputFactory.newFactory();
    for (int i = 1; i < a.length; i++) {
      List<String> errs = new ArrayList<>();
      int interchanges = 0, sets = 0, segs = 0; String fatal = null;
      try (InputStream in = new BufferedInputStream(Files.newInputStream(Paths.get(a[i]))); EDIStreamReader r = f.createEDIStreamReader(in)) {
        String set = null;
        while (r.hasNext()) {
          EDIStreamEvent e = r.next();
          switch (e) {
            case START_INTERCHANGE: interchanges++; break;
            case START_TRANSACTION: sets++; break;
            case START_SEGMENT: segs++; break;
            case ELEMENT_DATA:
              if ("ST".equals(r.getLocation().getSegmentTag()) && r.getLocation().getElementPosition() == 1) {
                set = r.getText();
                Path p = schemaDir.resolve(set + ".xml");
                if (Files.exists(p)) {
                  Schema s = cache.get(set);
                  if (s == null) { try (InputStream si = Files.newInputStream(p)) { s = sf.createSchema(si); } cache.put(set, s); }
                  r.setTransactionSchema(s);
                }
              }
              break;
            case SEGMENT_ERROR: case ELEMENT_DATA_ERROR: case ELEMENT_OCCURRENCE_ERROR:
              Location l = r.getLocation();
              errs.add("{\"error\":\"" + r.getErrorType() + "\",\"segment\":\"" + esc(l.getSegmentTag()) + "\",\"segment_position\":" + l.getSegmentPosition() + ",\"element\":" + l.getElementPosition() + ",\"set\":\"" + esc(set) + "\",\"text\":\"" + esc(e == EDIStreamEvent.SEGMENT_ERROR ? r.getText() : r.getText()) + "\"}");
              break;
            default: break;
          }
        }
      } catch (Exception ex) { fatal = ex.getClass().getSimpleName() + ": " + ex.getMessage(); }
      System.out.println("{\"file\":\"" + esc(a[i]) + "\",\"interchanges\":" + interchanges + ",\"transaction_sets\":" + sets + ",\"segments\":" + segs + ",\"fatal\":" + (fatal == null ? "null" : "\"" + esc(fatal) + "\"") + ",\"errors\":[" + String.join(",", errs) + "]}");
    }
  }
}
