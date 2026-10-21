/** Existing preparation labels shared by admin and staff, independent of the
 * task workflow vocabulary (not every equipment department has a workflow). */
export const PREPARATION_DEPARTMENTS:Record<string,string>={
  kosha:'الكوشات',lighting:'الإضاءة',sound:'الصوتيات',photography:'التصوير',flowers:'الزهور',rental:'الإيجار',decorations:'الديكور',transportation:'النقل',
  gifts:'الهدايا والتوزيعات',graduation:'تجهيزات التخرج',invitations:'الدعوات',transport:'النقل',equipment:'المعدات',other:'أخرى',
};
export const preparationDepartmentLabel=(value:string)=>PREPARATION_DEPARTMENTS[value]??value;
