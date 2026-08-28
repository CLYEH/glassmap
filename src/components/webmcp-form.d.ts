import "react";

/**
 * Attributes of the WebMCP *declarative* API (see `docs/webmcp-reference.md`,
 * "Chrome declarative API"). A browser that supports it turns the annotated
 * form into a tool; every other browser sees a plain form and ignores them,
 * which is why they are typed as optional strings rather than hidden behind a
 * feature check.
 */
declare module "react" {
  // The type parameters are unused here but must match the declarations being
  // merged into, or the augmentation is silently a different interface.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface FormHTMLAttributes<T> {
    /** Tool name the agent sees, e.g. "add_note". */
    toolname?: string;
    /** One-line description of what submitting the form does. */
    tooldescription?: string;
    /** Present = the agent may submit the form itself instead of only filling it. */
    toolautosubmit?: string;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface InputHTMLAttributes<T> {
    /** What this field means, for the agent filling it in. */
    toolparamdescription?: string;
  }
}
