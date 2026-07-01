// adds a label, with <wbr> after certain characters so long labels can wrap there.
export function appendLabelWithBreaks(target: HTMLElement, label: string): void {
  const segments = label.split(/(?<=[/\\|,.:;-])/); // the delimiter stays on the line above
  segments.forEach((segment, index) => {
    target.append(segment);
    const isLastSegment = index === segments.length - 1;
    if (!isLastSegment) target.append(document.createElement('wbr'));
  });
}
